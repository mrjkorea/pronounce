// Citrinet trial: Whistle is the door, Citrinet colors words, ZIPA only hints.
// Models are loaded once. A take does not reload them.

import { tokenizeWords } from './engine.js';
import { citrinetFeatures, framesAsChannelsFirst, framesAsTimeMajor, zipaFeatures } from './nemo-fbank.js';
import { encodeCitrinet, loadCitrinetPieces } from './citrinet-encode.js';

export const DOOR_FAIL_TEXT = 'Say the sentence again, please. Say each word clearly.';
export const DOOR_CHECKING_TEXT = 'Now checking pronunciation.';
export const DOOR_OVERLAP = 0.5;
export const SUBSAMPLE = 8;
export const FRAME_MS = 10;
export const HINT_PAD_MS = 80;
const BLANK_ID = 1024;
const NEG = -1e30;

export function bootAssetPaths() {
  return [
    'models/whistle/whistle.cact',
    'models/citrinet/model.int8.onnx',
    'models/citrinet/sp_pieces.json',
    'models/zipa/model.int8.onnx',
    'models/zipa/tokens.txt',
  ];
}

let runtime = {
  needle: null,
  citrinet: null,
  pieces: null,
  zipa: null,
  zipaTokens: null,
  phonemize: null,
  zipaError: '',
  ready: false,
};

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

function mallocBytes(mod, bytes) {
  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  return ptr;
}

function writeFloats(mod, samples) {
  const ptr = mod._malloc(samples.length * 4);
  new Float32Array(mod.HEAPU8.buffer, ptr, samples.length).set(samples);
  return ptr;
}

export async function loadWhistle(mod, cactBytes) {
  const ptr = mallocBytes(mod, cactBytes);
  const rc = mod._needle_load(ptr, BigInt(cactBytes.length));
  if (rc < 0) {
    const err = mod.UTF8ToString(mod._needle_last_error());
    throw new Error(err || ('needle_load ' + rc));
  }
  if ((mod._needle_models() & 2) === 0) throw new Error('Whistle speech model did not load');
  return rc;
}

export function transcribeWhistle(mod, samples, keywords) {
  const pcmPtr = writeFloats(mod, samples);
  const outCap = 65536;
  const outPtr = mod._malloc(outCap);
  try {
    const rc = mod.ccall(
      'needle_transcribe',
      'number',
      ['number', 'number', 'string', 'string', 'number', 'number', 'number'],
      [pcmPtr, samples.length, 'en', keywords || '', 0, outPtr, outCap],
    );
    const json = mod.UTF8ToString(outPtr);
    if (rc < 0) {
      const err = mod.UTF8ToString(mod._needle_last_error());
      throw new Error(err || json || ('needle_transcribe ' + rc));
    }
    const parsed = JSON.parse(json);
    return { text: parsed.text || '', language: parsed.language || '', raw: parsed };
  } finally {
    mod._free(pcmPtr);
    mod._free(outPtr);
  }
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

export async function runCitrinetSession(session, piecesModel, samples, targetText, passAt) {
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
  const timeSteps = dims[1];
  const vocab = dims[2];
  const encoded = encodeCitrinet(targetText, piecesModel);
  const align = forceAlign(logp.data, timeSteps, vocab, encoded.ids);
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
      hint: '',
    });
  }
  while (words.length < target.length) {
    words.push({ word: target[words.length], score: 0, startMs: 0, endMs: 0, hint: '' });
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
    grader: 'citrinet-trial',
  };
}

const SPELL_RULES = [
  [/[θð]/u, 'th'],
  [/ʃ/u, 'sh'],
  [/tʃ/u, 'ch'],
  [/dʒ/u, 'j'],
  [/[sz]/u, 's'],
  [/[ɹɻɾr]/u, 'r'],
  [/[lɫɭ]/u, 'l'],
  [/[vʋ]/u, 'v'],
  [/f/u, 'f'],
  [/b/u, 'b'],
  [/p/u, 'p'],
  [/d/u, 'd'],
  [/t/u, 't'],
  [/[kɡg]/u, 'k'],
  [/ŋ/u, 'ng'],
  [/m/u, 'm'],
  [/n/u, 'n'],
  [/w/u, 'w'],
  [/h/u, 'h'],
  [/j/u, 'y'],
  [/[iɪ]/u, 'ee'],
  [/ɛ/u, 'e'],
  [/[æa]/u, 'a'],
  [/[uʊ]/u, 'oo'],
  [/[ʌəɔɑɒ]/u, 'u'],
  [/o/u, 'o'],
];

export function spellPhone(phone) {
  const raw = String(phone || '').replace(/[ˈˌː.˞̴̥̩̪̺̃̚ʰʲʷʼ]/gu, '');
  if (!raw || raw === '▁' || raw === '<blk>' || raw === '<unk>' || raw === '<sos/eos>') return '';
  for (let i = 0; i < SPELL_RULES.length; i++) {
    if (SPELL_RULES[i][0].test(raw)) return SPELL_RULES[i][1];
  }
  if (/^[a-z]{1,3}$/.test(raw)) return raw;
  return '';
}

function spellSequence(phones) {
  const out = [];
  for (let i = 0; i < phones.length; i++) {
    const s = spellPhone(phones[i]);
    if (s && out[out.length - 1] !== s) out.push(s);
  }
  return out;
}

function greedyPhones(flat, timeSteps, vocab, tokens, length) {
  const limit = length || timeSteps;
  const phones = [];
  let prev = -1;
  for (let t = 0; t < limit; t++) {
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
    if (arg !== 0 && arg !== prev) {
      const piece = tokens.get(arg) || '';
      if (piece && piece !== '<blk>' && piece !== '<sos/eos>' && piece !== '<unk>' && piece !== '▁') phones.push(piece);
    }
    prev = arg;
  }
  return phones;
}

export function hintLine(expectedPhones, heardPhones) {
  const exp = spellSequence(expectedPhones);
  const heard = spellSequence(heardPhones);
  const n = Math.max(exp.length, heard.length);
  for (let i = 0; i < n; i++) {
    const want = exp[i] || '';
    const got = heard[i] || '';
    if (want && got && want !== got) return 'This sounded like ' + got + '. Try ' + want + '.';
  }
  return '';
}

export async function redWordHint(rt, samples, word, startMs, endMs) {
  try {
    if (!rt || !rt.zipa || !rt.phonemize || !word) return '';
    const sr = 16000;
    const pad = Math.floor(sr * HINT_PAD_MS / 1000);
    let a = Math.max(0, Math.floor(startMs * sr / 1000) - pad);
    let b = Math.min(samples.length, Math.ceil(endMs * sr / 1000) + pad);
    if (b - a < 160) {
      a = 0;
      b = Math.min(samples.length, 16000);
    }
    const slice = samples.subarray(a, b);
    if (!slice.length || isSilence(slice)) return '';
    const feats = zipaFeatures(slice);
    if (!feats.length) return '';
    const packed = framesAsTimeMajor(feats);
    const ort = rt.zipa.ort || globalThis.ort;
    const x = new ort.Tensor('float32', packed, [1, feats.length, 80]);
    const xLens = new ort.Tensor('int64', BigInt64Array.from([BigInt(feats.length)]), [1]);
    const out = await rt.zipa.run({ x, x_lens: xLens });
    const logp = out.log_probs;
    const steps = logp.dims[1];
    const vocab = logp.dims[2];
    const lenTensor = out.log_probs_len;
    const limit = lenTensor && lenTensor.data && lenTensor.data.length ? Number(lenTensor.data[0]) : steps;
    const heard = greedyPhones(logp.data, steps, vocab, rt.zipaTokens, limit);
    const ipa = await rt.phonemize(word, 'en-us');
    const expected = String((ipa && ipa[0]) || '').split('').filter(Boolean);
    return hintLine(expected, heard);
  } catch (err) {
    console.warn('ZIPA hint skipped', err);
    return '';
  }
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
    grader: 'citrinet-trial',
  };
}

export async function openDoor(mod, samples, targetText) {
  if (isSilence(samples)) return { ok: false, overlap: 0, text: '' };
  const keywords = normalizeWords(targetText).join('\n');
  const heard = transcribeWhistle(mod, samples, keywords);
  const door = doorFromTranscript(samples, targetText, heard.text);
  return { ok: door.ok, overlap: door.overlap, text: heard.text };
}

export async function initTrialEngine(parts) {
  runtime = {
    needle: parts.needle,
    citrinet: parts.citrinet,
    pieces: parts.pieces,
    zipa: parts.zipa || null,
    zipaTokens: parts.zipaTokens || null,
    phonemize: parts.phonemize || null,
    zipaError: parts.zipaError || '',
    ready: true,
  };
  return runtime;
}

export async function gradeTrialSamples(samples, targetText, passAt, hooks) {
  const rt = runtime;
  if (!rt.ready || !rt.needle || !rt.citrinet || !rt.pieces) throw new Error('Citrinet trial is not loaded');
  const door = await openDoor(rt.needle, samples, targetText);
  if (!door.ok) return { result: doorFailResult(targetText), door };
  if (hooks && hooks.onDoorPass) await hooks.onDoorPass();
  const result = await runCitrinetSession(rt.citrinet, rt.pieces, samples, targetText, passAt);
  for (let i = 0; i < result.words.length; i++) {
    const w = result.words[i];
    if (w.score >= passAt) continue;
    w.hint = await redWordHint(rt, samples, w.word, w.startMs, w.endMs);
  }
  return { result, door };
}

function parseZipaTokens(text) {
  const map = new Map();
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cut = line.lastIndexOf(' ');
    map.set(Number(line.slice(cut + 1)), line.slice(0, cut));
  }
  return map;
}

export async function bootTrialInPage(opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const ort = opts.ort || globalThis.ort;
  const createNeedle = opts.createNeedle || globalThis.createNeedle;
  if (!ort || !ort.InferenceSession) throw new Error('onnxruntime-web is not on the page');
  if (typeof createNeedle !== 'function') throw new Error('Needle WASM engine is not on the page');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
  const paths = opts.paths || bootAssetPaths();
  const responses = await Promise.all(paths.map(async (path) => {
    const res = await fetchImpl(path);
    if (!res.ok) throw new Error('missing ' + path);
    return res;
  }));
  const cact = new Uint8Array(await responses[0].arrayBuffer());
  const citrinetBuf = await responses[1].arrayBuffer();
  const pieces = loadCitrinetPieces(await responses[2].json());
  const needle = await createNeedle();
  await loadWhistle(needle, cact);
  const citrinet = await ort.InferenceSession.create(citrinetBuf, { executionProviders: ['wasm'] });
  citrinet.ort = ort;
  let zipa = null;
  let zipaTokens = null;
  let zipaError = '';
  try {
    const zipaBuf = await responses[3].arrayBuffer();
    zipaTokens = parseZipaTokens(await responses[4].text());
    zipa = await ort.InferenceSession.create(zipaBuf, { executionProviders: ['wasm'] });
    zipa.ort = ort;
  } catch (err) {
    zipa = null;
    zipaError = err && err.message ? err.message : String(err);
  }
  let phonemize = null;
  try {
    const espeak = await import('../vendor/espeak/dist/phonemizer.js');
    phonemize = espeak.phonemize;
  } catch (err) {
    phonemize = null;
    if (!zipaError) zipaError = err && err.message ? err.message : String(err);
  }
  return initTrialEngine({ needle, citrinet, pieces, zipa, zipaTokens, phonemize, zipaError });
}
