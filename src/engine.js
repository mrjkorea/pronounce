// MRJ Pronounce — browser engine (port of python_spike engine, identical math)
// G2P + CTC forced-alignment GOP scoring, pure JS, no server.

const NEG_INF = -1e30;
const OK_THRESHOLD = 0.75;
const WEAK_THRESHOLD = 0.5;

// ---------- normalize / tokenize ----------
function normalizeText(text) {
  if (text == null) return '';
  return String(text).trim().replace(/\s+/g, ' ');
}

function tokenizeWords(text) {
  const out = [];
  const re = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    out.push({ display: m[0], lookup: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------- G2P ----------
let _cmudict = null;
let _overrides = null;
let _arpabetIds = null; // { blank_id, map: {AA:[ids...]} }

async function loadG2P(baseUrl = '') {
  // Day 4 page: subset of the lines on the sheet, plus the two map files.
  const [cmu, ovr, aid] = await Promise.all([
    fetch(`${baseUrl}models/cmudict.day4.json`).then((r) => {
      if (!r.ok) throw new Error('dictionary load failed');
      return r.json();
    }),
    fetch(`${baseUrl}models/phone_overrides.json`).then(r => r.json()),
    fetch(`${baseUrl}models/arpabet_to_ids.json`).then(r => r.json()),
  ]);
  _cmudict = cmu;
  _overrides = ovr;
  _arpabetIds = aid;
  return { words: Object.keys(cmu).length, blankId: aid.blank_id };
}

function phonesForWord(word) {
  const w = word.toLowerCase();
  if (_overrides[w]) return { word, phones: _overrides[w], source: 'override' };
  if (_cmudict[w]) {
    const v = _cmudict[w];
    // cmudict.json: value may be a list of phone strings, or list of variants
    if (Array.isArray(v)) {
      if (v.length && Array.isArray(v[0])) return { word, phones: v[0], source: 'cmudict' };
      return { word, phones: v, source: 'cmudict' };
    }
    return { word, phones: [String(v)], source: 'cmudict' };
  }
  // Unknown word: no invented letter phones. Caller must fail the line.
  return { word, phones: [], source: 'naive' };
}

function unknownWords(text) {
  return tokenizeWords(normalizeText(text))
    .filter((t) => phonesForWord(t.lookup).source === 'naive')
    .map((t) => t.lookup);
}

function expectedPhoneSequence(text) {
  const words = tokenizeWords(normalizeText(text)).map(t => phonesForWord(t.lookup));
  const phones = [];
  for (const w of words) phones.push(...w.phones);
  return { phones, words };
}

// Fraction of words in a line that the dictionary knows (for OCR cleanup).
// naive fallback = unknown word. Returns 0..1
function dictionaryCoverage(text) {
  const toks = tokenizeWords(normalizeText(text));
  if (!toks.length) return 0;
  let known = 0;
  for (const t of toks) {
    if (phonesForWord(t.lookup).source !== 'naive') known++;
  }
  return known / toks.length;
}

// ---------- scoring ----------
function logSoftmax(logits) {
  const T = logits.length;
  const V = logits[0].length;
  const out = new Array(T);
  for (let t = 0; t < T; t++) {
    let m = -Infinity;
    for (let j = 0; j < V; j++) if (logits[t][j] > m) m = logits[t][j];
    let sum = 0;
    const row = new Array(V);
    for (let j = 0; j < V; j++) { row[j] = Math.exp(logits[t][j] - m); sum += row[j]; }
    const lse = m + Math.log(sum + 1e-12);
    for (let j = 0; j < V; j++) row[j] = logits[t][j] - lse;
    out[t] = row;
  }
  return out;
}

function expandedStates(primIds) {
  const out = [];
  for (const p of primIds) { out.push(null); out.push(p); }
  out.push(null);
  return out;
}

function viterbiPath(logP, states, blankId) {
  const T = logP.length;
  const V = logP[0].length;
  const S = states.length;
  const stateVocab = states.map(s => (s === null ? blankId : s));
  const logV = new Array(T);
  const back = new Array(T);
  for (let t = 0; t < T; t++) { logV[t] = new Array(S).fill(NEG_INF); back[t] = new Array(S).fill(0); }
  logV[0][0] = logP[0][stateVocab[0]];
  if (S > 1) logV[0][1] = logP[0][stateVocab[1]];
  for (let t = 1; t < T; t++) {
    const vPrev = logV[t - 1];
    for (let s = 0; s < S; s++) {
      let best = s;
      let bestVal = vPrev[s];
      if (s >= 1 && vPrev[s - 1] > bestVal) { best = s - 1; bestVal = vPrev[s - 1]; }
      if (s >= 2 && states[s] !== states[s - 2] && vPrev[s - 2] > bestVal) { best = s - 2; bestVal = vPrev[s - 2]; }
      logV[t][s] = bestVal + logP[t][stateVocab[s]];
      back[t][s] = best;
    }
  }
  const maxReach = 1 + 2 * (T - 1);
  let s = Math.min(S - 1, maxReach);
  const path = new Array(T);
  path[T - 1] = s;
  for (let t = T - 1; t > 0; t--) { s = back[t][s]; path[t - 1] = s; }
  return path;
}

function forcedAlignGop(logits, expectedPhones, blankId) {
  const T = logits.length;
  if (T === 0) return expectedPhones.map(p => ({ phone: p, score: 0, status: 'del', startFrame: null, endFrame: null }));
  if (!expectedPhones.length) return [];
  const logProbs = logSoftmax(logits);
  const probs = logProbs.map(row => row.map(Math.exp));
  const V = logits[0].length;

  const cands = expectedPhones.map(p => {
    const ids = _arpabetIds.map[p] || [];
    return ids.filter(i => i !== blankId);
  });
  const unknownFlags = cands.map(c => c.length === 0);

  if (unknownFlags.every(Boolean)) return equalSplitFallback(expectedPhones, probs, cands, V, blankId);

  const primIds = cands.map(c => (c.length ? c[0] : blankId));
  const states = expandedStates(primIds);

  // trellis emission: max over allophones
  const trellisLogp = logProbs.map(row => row.slice());
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.length > 1) {
      const prim = primIds[i];
      for (let t = 0; t < T; t++) {
        let mx = logProbs[t][c[0]];
        for (let k = 1; k < c.length; k++) if (logProbs[t][c[k]] > mx) mx = logProbs[t][c[k]];
        trellisLogp[t][prim] = mx;
      }
    }
  }

  let path;
  if (T === 1) path = [states.length > 1 ? 1 : 0];
  else path = viterbiPath(trellisLogp, states, blankId);

  const out = [];
  for (let i = 0; i < expectedPhones.length; i++) {
    const stateIdx = 2 * i + 1;
    const frames = [];
    for (let t = 0; t < T; t++) if (path[t] === stateIdx) frames.push(t);
    if (unknownFlags[i]) { out.push({ phone: expectedPhones[i], score: 0.15, status: 'unknown', startFrame: null, endFrame: null }); continue; }
    if (!frames.length) { out.push({ phone: expectedPhones[i], score: 0, status: 'del', startFrame: null, endFrame: null }); continue; }
    const pids = cands[i];
    // expected posterior mass
    let pSum = 0;
    for (const f of frames) {
      let mx = probs[f][pids[0]];
      for (let k = 1; k < pids.length; k++) if (probs[f][pids[k]] > mx) mx = probs[f][pids[k]];
      pSum += mx;
    }
    const pExp = pSum / frames.length;
    // strongest competitors (top-3 mean over non-blank, non-expected)
    const mask = new Array(V).fill(true);
    for (const cid of pids) mask[cid] = false;
    if (blankId >= 0 && blankId < V) mask[blankId] = false;
    let comp = 0;
    if (mask.some(Boolean)) {
      let compSum = 0;
      for (const f of frames) {
        // top-3 via single pass — avoids O(V log V) sort per frame
        let a = -1, b = -1, c = -1;
        const row = probs[f];
        for (let j = 0; j < V; j++) {
          if (!mask[j]) continue;
          const v = row[j];
          if (v > a) { c = b; b = a; a = v; }
          else if (v > b) { c = b; b = v; }
          else if (v > c) { c = v; }
        }
        compSum += (a + b + c) / 3;
      }
      comp = compSum / frames.length;
    }
    const score = Math.max(0, Math.min(1, pExp / (pExp + comp + 1e-6)));
    const status = score >= OK_THRESHOLD ? 'ok' : score >= WEAK_THRESHOLD ? 'weak' : 'sub';
    out.push({ phone: expectedPhones[i], score, status, startFrame: frames[0], endFrame: frames[frames.length - 1] });
  }
  return out;
}

function equalSplitFallback(expectedPhones, probs, cands, V, blankId) {
  const T = probs.length;
  const n = expectedPhones.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * T);
    const b = Math.min(Math.max(a + 1, Math.floor(((i + 1) / n) * T)), T);
    const cids = (cands[i] || []).filter(c => c >= 0 && c < V);
    let score = 0.15;
    let status = 'unknown';
    if (cids.length && b > a) {
      let pSum = 0;
      for (let t = a; t < b; t++) {
        let mx = probs[t][cids[0]];
        for (let k = 1; k < cids.length; k++) if (probs[t][cids[k]] > mx) mx = probs[t][cids[k]];
        pSum += mx;
      }
      const p = pSum / (b - a);
      const mask = new Array(V).fill(true);
      for (const cid of cids) mask[cid] = false;
      if (blankId >= 0 && blankId < V) mask[blankId] = false;
      let comp = 0;
      if (mask.some(Boolean)) {
        let compSum = 0;
        for (let t = a; t < b; t++) {
          let x = -1, y = -1, z = -1;
          const row = probs[t];
          for (let j = 0; j < V; j++) {
            if (!mask[j]) continue;
            const v = row[j];
            if (v > x) { z = y; y = x; x = v; }
            else if (v > y) { z = y; y = v; }
            else if (v > z) { z = v; }
          }
          compSum += (x + y + z) / 3;
        }
        comp = compSum / (b - a);
      }
      score = Math.max(0, Math.min(1, p / (p + comp + 1e-6)));
      status = score >= OK_THRESHOLD ? 'ok' : score >= WEAK_THRESHOLD ? 'weak' : 'sub';
    }
    out.push({ phone: expectedPhones[i], score, status, startFrame: a, endFrame: b - 1 });
  }
  return out;
}

function aggregate(text, wordPhones, phoneScores, audioDurationMs, sampleRate, modelId, latencyMs, opts = {}) {
  const wordsOut = [];
  let idx = 0;
  for (const wp of wordPhones) {
    const n = wp.phones.length;
    const chunk = phoneScores.slice(idx, idx + n);
    idx += n;
    let wscore = 0;
    let startMs = null;
    let endMs = null;
    if (chunk.length) {
      const frames = chunk.map(c => (c.startFrame != null && c.endFrame != null ? c.endFrame - c.startFrame + 1 : 1));
      let wsum = 0;
      let fsum = 0;
      chunk.forEach((c, i) => { wsum += c.score * frames[i]; fsum += frames[i]; });
      wscore = wsum / Math.max(1, fsum);
      startMs = chunk[0].startFrame == null ? null : chunk[0].startFrame * 20.0;
      endMs = chunk[chunk.length - 1].endFrame == null ? null : (chunk[chunk.length - 1].endFrame + 1) * 20.0;
    }
    wordsOut.push({
      word: wp.word, start_ms: startMs, end_ms: endMs, score: wscore,
      phones: chunk.map(c => ({ phone: c.phone, score: c.score, status: c.status, start_ms: c.startFrame == null ? null : c.startFrame * 20.0, end_ms: c.endFrame == null ? null : (c.endFrame + 1) * 20.0 })),
    });
  }
  let overallScore = 0;
  let band = 'invalid';
  if (wordsOut.length) {
    overallScore = wordsOut.reduce((a, w) => a + w.score, 0) / wordsOut.length;
    band = overallScore >= 0.8 ? 'good' : overallScore >= 0.65 ? 'ok' : 'needs_work';
  }
  const weak = phoneScores.filter(p => ['weak', 'sub', 'del', 'unknown'].includes(p.status)).length;
  const per = phoneScores.length ? weak / phoneScores.length : null;
  return {
    schema_version: '1.0', engine_id: 'mrj-pronounce', model_id: modelId, text, locale: 'en-US',
    expected_phones: wordPhones.flatMap(w => w.phones),
    words: wordsOut,
    overall: { score: overallScore, band, phone_error_rate_est: per },
    audio: { duration_ms: audioDurationMs, sample_rate: sampleRate, clipping: opts.clipping ?? null, too_quiet: opts.too_quiet ?? null, snr_est: opts.snr_est ?? null },
    meta: { scoring_mode: 'ctc_forced_gop_v1', offline: true, latency_ms: latencyMs, warnings: opts.warnings || [], engine_version: '0.1.0-browser' },
  };
}

export { loadG2P, expectedPhoneSequence, forcedAlignGop, aggregate, normalizeText, tokenizeWords, dictionaryCoverage, unknownWords };
