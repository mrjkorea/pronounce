// Citrinet pronunciation checker: greedy transcript door + forced-align word scores.
// Models load once per page; a take does not reload them.

import { tokenizeWords } from './engine.js';
import { citrinetFeatures, framesAsChannelsFirst } from './nemo-fbank.js';
import { encodeCitrinet, loadCitrinetPieces } from './citrinet-encode.js';

export const DOOR_FAIL_TEXT = 'Say the sentence again, please. Say each word clearly.';
export const DOOR_CHECKING_TEXT = 'Now checking pronunciation.';
export const DOOR_OVERLAP = 0.5;
export const SUBSAMPLE = 8;
export const FRAME_MS = 10;
const BLANK_ID = 1024;
const NEG = -1e30;

export function bootModelPaths() {
  return [
    'models/citrinet/model.int8.onnx',
    'models/citrinet/sp_pieces.json',
  ];
}

let runtime = {
  citrinet: null,
  pieces: null,
  tokenById: null,
  ready: false,
};

function loadCitrinetTokenMap(table) {
  const pieces = table.pieces || table;
  const map = new Map();
  for (let i = 0; i < pieces.length; i++) {
    const row = pieces[i];
    if (row && row.id != null) map.set(row.id, row.piece || '');
  }
  return map;
}

/** Greedy CTC decode for Citrinet log-probs (door transcript). */
export function greedyCitrinetTranscript(flat, timeSteps, vocab, tokenById) {
  const parts = [];
  let prev = -1;
  for (let t = 0; t < timeSteps; t++) {
    const base = t * vocab;
    let best = flat[base];
    let arg = 0;
    for (let v = 1; v < vocab; v++) {
      const p = flat[base + v];
      if (p > best) {
        best = p;
        arg = v;
      }
    }
    if (arg !== BLANK_ID && arg !== prev) {
      const piece = tokenById.get(arg) || '';
      if (piece && piece !== '<blk>' && piece !== '<unk>' && piece !== '<sos/eos>') parts.push(piece);
    }
    prev = arg;
  }
  const SPI = '\u2581';
  return parts.join('').replace(new RegExp(SPI, 'g'), ' ').replace(/\s+/g, ' ').trim();
}

export function trialRuntime() {
  return runtime;
}

export function isSilence(samples) {
  if (!samples || !samples.length) return true;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms < 0.005;
}

export function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Uint16Array(n + 1);
  let cur = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      cur[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[n];
}

function closeWord(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const d = levenshtein(a, b);
  const longer = Math.max(a.length, b.length);
  return d <= 1 || (longer >= 5 && d / longer <= 0.34);
}

/** Target words that have a close heard match, allowing one split or one glue. */
export function overlapRatio(targetWords, heardWords) {
  const t = targetWords.length;
  const h = heardWords.length;
  if (!t) return 0;
  if (!h) return 0;
  const dp = new Int16Array((t + 1) * (h + 1));
  const ix = (i, j) => i * (h + 1) + j;
  for (let i = 0; i <= t; i++) {
    for (let j = 0; j <= h; j++) {
      let best = 0;
      if (i > 0) best = dp[ix(i - 1, j)];
      if (j > 0 && dp[ix(i, j - 1)] > best) best = dp[ix(i, j - 1)];
      if (i > 0 && j > 0 && closeWord(targetWords[i - 1], heardWords[j - 1])) {
        const v = dp[ix(i - 1, j - 1)] + 1;
        if (v > best) best = v;
      }
      if (i > 0 && j > 1 && closeWord(targetWords[i - 1], heardWords[j - 2] + heardWords[j - 1])) {
        const v = dp[ix(i - 1, j - 2)] + 1;
        if (v > best) best = v;
      }
      if (i > 1 && j > 0 && closeWord(targetWords[i - 2] + targetWords[i - 1], heardWords[j - 1])) {
        const v = dp[ix(i - 2, j - 1)] + 2;
        if (v > best) best = v;
      }
      dp[ix(i, j)] = best;
    }
  }
  return dp[ix(t, h)] / t;
}

export function doorFromTranscript(samples, targetText, transcript) {
  if (isSilence(samples) || !String(transcript || '').trim()) {
    return { ok: false, overlap: 0, heard: [] };
  }
  const target = normalizeWords(targetText);
  const heard = normalizeWords(transcript);
  const overlap = overlapRatio(target, heard);
  return { ok: overlap >= DOOR_OVERLAP, overlap, heard, target };
}

function logRow(flat, t, vocab, time) {
  return flat.subarray(time * vocab, (time + 1) * vocab);
}

function forceAlign(flat, timeSteps, vocab, tokenIds) {
  const u = tokenIds.length;
  const states = 2 * u + 1;
  const labels = new Int32Array(states);
  for (let s = 0; s < states; s++) labels[s] = (s & 1) === 0 ? BLANK_ID : tokenIds[(s - 1) >> 1];
  let prev = new Float64Array(states);
  prev.fill(NEG);
  let cur = new Float64Array(states);
  const back = new Int16Array(timeSteps * states);
  back.fill(-1);
  const row0 = logRow(flat, 0, vocab, 0);
  prev[0] = row0[BLANK_ID];
  if (u) prev[1] = row0[tokenIds[0]];
  for (let t = 1; t < timeSteps; t++) {
    cur.fill(NEG);
    const row = logRow(flat, t, vocab, t);
    for (let s = 0; s < states; s++) {
      let best = prev[s];
      let arg = s;
      if (s > 0 && prev[s - 1] > best) {
        best = prev[s - 1];
        arg = s - 1;
      }
      if (s > 1 && labels[s] !== BLANK_ID && labels[s] !== labels[s - 2] && prev[s - 2] > best) {
        best = prev[s - 2];
        arg = s - 2;
      }
      if (best > NEG / 2) {
        cur[s] = best + row[labels[s]];
        back[t * states + s] = arg;
      }
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  let s = states - 1;
  if (u && prev[states - 2] > prev[s]) s = states - 2;
  if (!(prev[s] > NEG / 2)) return null;
  const path = new Int16Array(timeSteps);
  for (let t = timeSteps - 1; t >= 0; t--) {
    path[t] = s;
    if (t > 0) s = back[t * states + s];
  }
  const frames = tokenIds.map(() => []);
  for (let t = 0; t < timeSteps; t++) {
    const st = path[t];
    if (labels[st] === BLANK_ID) continue;
    frames[(st - 1) >> 1].push(t);
  }
  return { frames, flat, vocab };
}

function tokenProbability(align, tokenIndex, tokenId) {
  const frames = align.frames[tokenIndex];
  if (!frames || !frames.length) return 0;
  let sum = 0;
  for (let i = 0; i < frames.length; i++) {
    const t = frames[i];
    sum += Math.exp(align.flat[t * align.vocab + tokenId]);
  }
  return sum / frames.length;
}

export async function forwardCitrinet(session, samples) {
  const feats = citrinetFeatures(samples);
  if (!feats.length) throw new Error('Citrinet got no feature frames');
  const channels = framesAsChannelsFirst(feats);
  const ort = session.ort || globalThis.ort;
  const Tensor = ort.Tensor;
  const audio = new Tensor('float32', channels, [1, 80, feats.length]);
  const length = new Tensor('int64', BigInt64Array.from([BigInt(feats.length)]), [1]);
  const out = await session.run({ audio_signal: audio, length });
  const logp = out.logprobs;
  const dims = logp.dims;
  return {
    data: logp.data,
    timeSteps: dims[1],
    vocab: dims[2],
  };
}

export function gradeCitrinetFromLogp(logpData, timeSteps, vocab, piecesModel, targetText, passAt) {
  const encoded = encodeCitrinet(targetText, piecesModel);
  const align = forceAlign(logpData, timeSteps, vocab, encoded.ids);
  const msPer = SUBSAMPLE * FRAME_MS;
  const target = normalizeWords(targetText);
  const display = tokenizeWords(targetText).map((row) => row.display);
  const grouped = encoded.words;
  const words = [];
  let cursor = 0;
  for (let w = 0; w < grouped.length; w++) {
    const group = grouped[w];
    const label = display[w] || target[w] || group.text;
    let probSum = 0;
    let first = -1;
    let last = -1;
    for (let k = 0; k < group.ids.length; k++) {
      const tokenIndex = cursor + k;
      const frames = align && align.frames[tokenIndex];
      if (frames && frames.length) {
        if (first < 0) first = frames[0];
        last = frames[frames.length - 1];
      }
      probSum += align ? tokenProbability(align, tokenIndex, group.ids[k]) : 0;
    }
    cursor += group.ids.length;
    const score = group.ids.length ? (probSum / group.ids.length) * 100 : 0;
    words.push({
      word: label,
      score,
      startMs: first < 0 ? 0 : first * msPer,
      endMs: last < 0 ? 0 : (last + 1) * msPer,
    });
  }
  while (words.length < target.length) {
    words.push({ word: target[words.length], score: 0, startMs: 0, endMs: 0 });
  }
  const avg = words.length ? words.reduce((s, w) => s + w.score, 0) / words.length : 0;
  const passCut = passAt;
  const pass = avg >= passCut;
  return {
    score: avg / 100,
    scorePct: Math.round(avg),
    pass,
    weak: words.filter((w) => w.score < passCut).map((w) => w.word),
    reason: pass ? '' : 'The sounds did not match. Loud noise does not pass.',
    english: targetText,
    words,
    doorFail: false,
    grader: 'citrinet',
  };
}

export function doorFailResult(targetText) {
  return {
    score: 0,
    scorePct: 0,
    pass: false,
    weak: [],
    reason: DOOR_FAIL_TEXT,
    english: targetText,
    words: [],
    doorFail: true,
    grader: 'citrinet',
  };
}

export async function initTrialEngine(parts) {
  runtime = {
    citrinet: parts.citrinet,
    pieces: parts.pieces,
    tokenById: parts.tokenById || null,
    ready: true,
  };
  return runtime;
}

function emptyPerf() {
  return { citrinetMs: 0, totalMs: 0 };
}

export async function gradeTrialSamples(samples, targetText, passAt, hooks, opts) {
  const rt = runtime;
  if (!rt.ready || !rt.citrinet || !rt.pieces) throw new Error('Sound checker is not loaded');
  const perf = emptyPerf();
  const tAll = typeof performance !== 'undefined' ? performance.now() : 0;

  if (isSilence(samples)) {
    perf.totalMs = typeof performance !== 'undefined' ? performance.now() - tAll : 0;
    return {
      result: doorFailResult(targetText),
      door: { ok: false, overlap: 0, text: '' },
      perf,
    };
  }
  const tCit = typeof performance !== 'undefined' ? performance.now() : 0;
  const fwd = await forwardCitrinet(rt.citrinet, samples);
  perf.citrinetMs = typeof performance !== 'undefined' ? performance.now() - tCit : 0;
  const transcript = rt.tokenById
    ? greedyCitrinetTranscript(fwd.data, fwd.timeSteps, fwd.vocab, rt.tokenById)
    : '';
  const door = doorFromTranscript(samples, targetText, transcript);
  if (!door.ok) {
    perf.totalMs = typeof performance !== 'undefined' ? performance.now() - tAll : 0;
    return { result: doorFailResult(targetText), door, perf };
  }
  if (hooks && hooks.onDoorPass) hooks.onDoorPass();
  const result = gradeCitrinetFromLogp(
    fwd.data,
    fwd.timeSteps,
    fwd.vocab,
    rt.pieces,
    targetText,
    passAt,
  );
  perf.totalMs = typeof performance !== 'undefined' ? performance.now() - tAll : 0;
  return { result, door, perf };
}

export async function bootTrialInPage(opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const ort = opts.ort || globalThis.ort;
  if (!ort || !ort.InferenceSession) throw new Error('onnxruntime-web is not on the page');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
  const paths = opts.paths || bootModelPaths();
  const responses = await Promise.all(paths.map(async (path) => {
    const res = await fetchImpl(path);
    if (!res.ok) throw new Error('missing ' + path);
    return res;
  }));
  const citrinetBuf = await responses[0].arrayBuffer();
  const piecesJson = await responses[1].json();
  const pieces = loadCitrinetPieces(piecesJson);
  const tokenById = loadCitrinetTokenMap(piecesJson);
  const citrinet = await ort.InferenceSession.create(citrinetBuf, { executionProviders: ['wasm'] });
  citrinet.ort = ort;
  await initTrialEngine({
    citrinet,
    pieces,
    tokenById,
  });
  return runtime;
}
