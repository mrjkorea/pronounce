// MRJ Pronounce — Single HuBERT-base Phoneme CTC Engine (ron-jo/hubert-base-phoneme-en-onnx, Apache-2.0)
// - Sound-only grading: VAD + near-field gate + CTC forced alignment vs free phoneme decode
// - No text transcript door check
// - Download once & cache in Cache Storage / IndexedDB with startup check & progress
// - Single-thread WASM onnxruntime-web inside a dedicated Web Worker
// - Unified API for Day 4, Day 6, Phonics / Decodable Readers, and TOEIC Read-Aloud

import {
  APP_THRESHOLDS,
  ARPABET_PHONES,
  BLANK_ID,
  FRAME_MS,
  MODEL_ID,
  VOCAB_SIZE,
  bandForScore,
  expectedPhoneSequence,
  getAppThresholds,
  PASS_PCT,
  initG2PFromData,
  isG2PLoaded,
  loadG2P,
  scoreUtteranceFromLogits,
  tokenizeWords,
} from './engine.js';
import {
  TARGET_SAMPLE_RATE,
   decodeAudioToMono,
  prepareSpeechSamples,
} from './audio.js';

export const DOOR_FAIL_TEXT = 'Say the sentence again, please. Say each word clearly.';
export const DOOR_CHECKING_TEXT = 'Now checking pronunciation.';

export const MODEL_CACHE_NAME = 'mrj-hubert-phoneme-en-int8-v1';
export const MODEL_CACHE_URL = 'https://mrj-pronounce.local/models/hubert-base-phoneme-en-int8.onnx';
export const DICT_CACHE_URL = 'https://mrj-pronounce.local/models/cmudict.full.json';
export const IDB_DB_NAME = 'mrj-pronounce-model-cache-v1';
export const IDB_STORE_NAME = 'assets';
export const EXPECTED_MODEL_BYTES = 122222068;

export function bootModelPaths() {
  return [
    'models/hubert/manifest.json',
    'models/hubert/part-00.bin',
    'models/hubert/part-01.bin',
    'models/hubert/part-02.bin',
    'models/cmudict.full.json',
    'models/arpabet_to_ids.json',
  ];
}

let runtime = {
  session: null,
  worker: null,
  ready: false,
  modelId: MODEL_ID,
  cachedBytes: 0,
  fromCache: false,
  cacheSource: 'none',
};

let workerReqSeq = 0;
const workerPending = new Map();

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

// ---------- Browser Cache Storage + IndexedDB Persistence ----------

function openIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

async function idbGet(key) {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).get(key);
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch (_) {
      db.close();
      resolve(null);
    }
  });
}

async function idbPut(key, value) {
  const db = await openIdb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch (_) {
      db.close();
      resolve(false);
    }
  });
}

async function cacheStorageGetBuffer(urlKey, minBytes = 1024) {
  if (typeof caches === 'undefined' || !caches.open) return null;
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const match = await cache.match(urlKey);
    if (!match) return null;
    const buf = await match.arrayBuffer();
    if (buf && buf.byteLength >= minBytes) return buf;
  } catch (_) {}
  return null;
}

async function cacheStoragePutBuffer(urlKey, arrayBuffer, contentType = 'application/octet-stream') {
  if (typeof caches === 'undefined' || !caches.open) return false;
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const res = new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(arrayBuffer.byteLength),
      },
    });
    await cache.put(urlKey, res);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Startup check: inspect Cache Storage and IndexedDB for already-cached HuBERT model.
 */
export async function checkModelCached(expectedBytes = EXPECTED_MODEL_BYTES) {
  const csBuf = await cacheStorageGetBuffer(MODEL_CACHE_URL, expectedBytes);
  if (csBuf && csBuf.byteLength === expectedBytes) {
    return { cached: true, source: 'cache-storage', byteLength: csBuf.byteLength, buffer: csBuf };
  }
  const idbBuf = await idbGet(MODEL_CACHE_URL);
  if (idbBuf && idbBuf.byteLength === expectedBytes) {
    return { cached: true, source: 'indexeddb', byteLength: idbBuf.byteLength, buffer: idbBuf };
  }
  return { cached: false, source: 'none', byteLength: 0, buffer: null };
}

async function fetchPartWithProgress(url, fetchImpl, onPartBytes) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error('Failed to download ' + url + ' (' + res.status + ')');
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let len = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength) {
        chunks.push(value);
        len += value.byteLength;
        if (onPartBytes) onPartBytes(value.byteLength);
      }
    }
    const out = new Uint8Array(len);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  const buf = await res.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (onPartBytes) onPartBytes(u8.byteLength);
  return u8;
}

/**
 * Load the HuBERT ONNX model from Cache Storage / IndexedDB if already cached,
 * or download the chunked parts with byte-level progress and persist to cache.
 */
export async function loadOrCacheModelBuffer(opts = {}) {
  const baseUrl = opts.baseUrl || '';
  const fetchImpl = opts.fetchImpl || fetch;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  onProgress(0.02, 'Checking local model cache…');
  const existing = await checkModelCached(EXPECTED_MODEL_BYTES);
  if (existing.cached && existing.buffer) {
    onProgress(0.85, 'Loaded sound checker from local cache…');
    return {
      buffer: existing.buffer,
      fromCache: true,
      cacheSource: existing.source,
      byteLength: existing.byteLength,
    };
  }

  const manifestRes = await fetchImpl(`${baseUrl}models/hubert/manifest.json`);
  if (!manifestRes.ok) throw new Error('missing models/hubert/manifest.json');
  const manifest = await manifestRes.json();
  const totalBytes = manifest.totalBytes || EXPECTED_MODEL_BYTES;
  const parts = manifest.parts || [];

  const recheck = await checkModelCached(totalBytes);
  if (recheck.cached && recheck.buffer) {
    onProgress(0.85, 'Loaded sound checker from local cache…');
    return {
      buffer: recheck.buffer,
      fromCache: true,
      cacheSource: recheck.source,
      byteLength: recheck.byteLength,
    };
  }

  const assembled = new Uint8Array(totalBytes);
  let loadedBytes = 0;
  let writeOffset = 0;

  for (let i = 0; i < parts.length; i++) {
    const partUrl = `${baseUrl}${parts[i].file}`;
    const partData = await fetchPartWithProgress(partUrl, fetchImpl, (delta) => {
      loadedBytes += delta;
      const frac = Math.min(0.82, 0.05 + (loadedBytes / totalBytes) * 0.77);
      const mbDone = (loadedBytes / (1024 * 1024)).toFixed(0);
      const mbTotal = (totalBytes / (1024 * 1024)).toFixed(0);
      onProgress(frac, `Downloading sound checker… ${mbDone} / ${mbTotal} MB`);
    });
    assembled.set(partData, writeOffset);
    writeOffset += partData.byteLength;
  }

  const finalBuffer = assembled.buffer;
  onProgress(0.85, 'Caching sound checker for offline use…');
  const savedCs = await cacheStoragePutBuffer(MODEL_CACHE_URL, finalBuffer, 'application/octet-stream');
  const savedIdb = await idbPut(MODEL_CACHE_URL, finalBuffer);

  return {
    buffer: finalBuffer,
    fromCache: false,
    cacheSource: savedCs ? 'cache-storage' : (savedIdb ? 'indexeddb' : 'memory'),
    byteLength: finalBuffer.byteLength,
  };
}

async function loadOrCacheG2PDictionary(baseUrl = '', fetchImpl = fetch) {
  if (isG2PLoaded()) return;
  let cmuBuf = await cacheStorageGetBuffer(DICT_CACHE_URL, 10000);
  if (!cmuBuf) cmuBuf = await idbGet(DICT_CACHE_URL);

  let cmuJson = null;
  if (cmuBuf) {
    try {
      const text = new TextDecoder().decode(cmuBuf);
      cmuJson = JSON.parse(text);
    } catch (_) {
      cmuJson = null;
    }
  }
  if (!cmuJson) {
    const res = await fetchImpl(`${baseUrl}models/cmudict.full.json`);
    if (!res.ok) throw new Error('missing models/cmudict.full.json');
    const rawBuf = await res.arrayBuffer();
    await cacheStoragePutBuffer(DICT_CACHE_URL, rawBuf, 'application/json');
    await idbPut(DICT_CACHE_URL, rawBuf);
    cmuJson = JSON.parse(new TextDecoder().decode(rawBuf));
  }

  let aidJson = null;
  try {
    const aidRes = await fetchImpl(`${baseUrl}models/arpabet_to_ids.json`);
    if (aidRes.ok) aidJson = await aidRes.json();
  } catch (_) {}

  initG2PFromData(cmuJson, aidJson);
}

// ---------- Worker & Direct ONNX Runtime Inference ----------

function callWorker(worker, payload, transfers = []) {
  return new Promise((resolve, reject) => {
    const id = ++workerReqSeq;
    workerPending.set(id, { resolve, reject });
    worker.postMessage({ ...payload, id }, transfers);
  });
}

function attachWorkerHandlers(worker) {
  worker.onmessage = (ev) => {
    const msg = ev.data || {};
    const pending = workerPending.get(msg.id);
    if (!pending) return;
    workerPending.delete(msg.id);
    if (msg.ok) pending.resolve(msg);
    else pending.reject(new Error(msg.error || 'Worker inference error'));
  };
  worker.onerror = (err) => {
    for (const [, p] of workerPending) {
      p.reject(new Error(err?.message || 'Worker crashed'));
    }
    workerPending.clear();
  };
}

export async function forwardHubertPhoneme(rtOrSession, normalizedSamples) {
  if (!normalizedSamples || !normalizedSamples.length) {
    throw new Error('HuBERT got empty audio samples');
  }
  // If worker is active on runtime
  if (rtOrSession && rtOrSession.worker) {
    const copy = new Float32Array(normalizedSamples);
    const out = await callWorker(
      rtOrSession.worker,
      { type: 'forward', samples: copy },
      [copy.buffer],
    );
    return {
      data: out.data,
      timeSteps: out.timeSteps,
      vocab: out.vocab,
      inferMs: out.inferMs,
    };
  }

  const session = rtOrSession.session || rtOrSession.hubert || rtOrSession;
  const ort = session.ort || globalThis.ort;
  const Tensor = ort.Tensor;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const input = new Tensor('float32', normalizedSamples, [1, normalizedSamples.length]);
  const out = await session.run({ input_values: input });
  const inferMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const logits = out.logits;
  const dims = logits.dims;
  return {
    data: logits.data,
    timeSteps: dims[1],
    vocab: dims[2],
    inferMs,
  };
}

export function doorFailResult(targetText, reason = DOOR_FAIL_TEXT, appId = 'day4') {
  const { words: wordSpecs } = expectedPhoneSequence(targetText);
  const thresholds = getAppThresholds(appId);
  return {
    score: 0,
    scorePct: 0,
    rawScorePct: 0,
    band: 'red',
    color: 'red',
    pass: false,
    assistedPass: false,
    needsAudioPlayback: true,
    weak: wordSpecs.map((w) => w.display || w.word),
    missedWords: wordSpecs.map((w) => w.display || w.word),
    yellowWords: [],
    greenWords: [],
    reason: reason || DOOR_FAIL_TEXT,
    english: targetText,
    words: [],
    doorFail: true,
    acousticFail: true,
    thresholds,
    appId,
    grader: 'hubert-phoneme',
    modelId: MODEL_ID,
  };
}

export async function initTrialEngine(parts = {}) {
  runtime = {
    session: parts.session || parts.hubert || null,
    worker: parts.worker || null,
    ready: true,
    modelId: MODEL_ID,
    cachedBytes: parts.cachedBytes || EXPECTED_MODEL_BYTES,
    fromCache: !!parts.fromCache,
    cacheSource: parts.cacheSource || 'memory',
  };
  return runtime;
}

/**
 * Grade 16 kHz mono PCM samples against targetText using sound only:
 * 1. Trim silence before & after speech + Near-field gate (-12 dB + F0 pitch)
 * 2. VAD + Spectral clarity gate (rejects silence & low-pass mumbles)
 * 3. HuBERT phoneme CTC forward pass
 * 4. Forced alignment vs Free phoneme decode acoustic gate + phoneme/word/line scoring
 * 5. The target is always the whole sentence. Single-word retries are not graded.
 */
export async function gradeTrialSamples(samples, targetText, passAt, hooks, opts = {}) {
  const rt = runtime;
  if (!rt.ready || (!rt.worker && !rt.session)) {
    throw new Error('Sound checker is not loaded');
  }
  if (!isG2PLoaded()) {
    await loadG2P(opts.baseUrl || '');
  }

  const tAll = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const sampleRate = opts.sampleRate || TARGET_SAMPLE_RATE;
  const appId = opts.appId || 'day4';

  // Step 1: Trim silence + Near-field gate (-12 dB + pitch) + normalize
  const tPrep0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prep = prepareSpeechSamples(samples, sampleRate, opts);
  const prepMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tPrep0;

  // Step 2: Sound-only VAD & spectral mumble gate
  if (prep.stats.tooQuiet || prep.stats.mumbled) {
    const totalMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tAll;
    const failReason = prep.stats.mumbled
      ? 'Speak clearly with your mouth open. Say each word clearly.'
      : DOOR_FAIL_TEXT;
    return {
      result: doorFailResult(targetText, failReason, appId),
      door: {
        ok: false,
        reason: prep.stats.mumbled ? 'mumbled' : 'silence',
        stats: prep.stats,
      },
      perf: {
        prepMs: Math.round(prepMs),
        hubertMs: 0,
        alignMs: 0,
        totalMs: Math.round(totalMs),
        trimmedAudioMs: Math.round(prep.stats.durationMs),
      },
      audioStats: prep.stats,
      nearField: prep.nearField,
    };
  }

  // Step 3: HuBERT phoneme CTC inference
  const tInfer0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const fwd = await forwardHubertPhoneme(rt, prep.normalized);
  const hubertMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tInfer0;

  // Step 4: Phoneme forced alignment, free-decode acoustic gate & Korean-L1 diagnosis
  const tAlign0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const result = scoreUtteranceFromLogits(fwd.data, fwd.timeSteps, targetText, {
    passAt,
    appId,
    acousticMarginCut: opts.acousticMarginCut,
  });
  const alignMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tAlign0;

  if (!result.acousticFail && hooks && typeof hooks.onDoorPass === 'function') {
    hooks.onDoorPass();
  }

  const totalMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tAll;
  const perf = {
    prepMs: Math.round(prepMs),
    hubertMs: Math.round(hubertMs),
    alignMs: Math.round(alignMs),
    totalMs: Math.round(totalMs),
    trimmedAudioMs: Math.round(prep.stats.durationMs),
  };

  return {
    result: {
      ...result,
      audioStats: prep.stats,
      nearField: prep.nearField,
      perf,
    },
    door: {
      ok: !result.acousticFail,
      ...result.acousticGate,
    },
    perf,
    audioStats: prep.stats,
    nearField: prep.nearField,
  };
}

/**
 * Boot the HuBERT phoneme engine in the browser (or Node test harness):
 * 1. Loads & caches `cmudict.full.json` (124,926 words) + phonics G2P rules
 * 2. Checks Cache Storage / IndexedDB for `ron-jo/hubert-base-phoneme-en-onnx` (downloads with progress if needed)
 * 3. Spawns single-thread WASM Web Worker (`src/grade-worker.js`) with in-page fallback
 */
export async function bootTrialInPage(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const baseUrl = opts.baseUrl || '';
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  await loadOrCacheG2PDictionary(baseUrl, fetchImpl);
  const modelAsset = await loadOrCacheModelBuffer({
    baseUrl,
    fetchImpl,
    onProgress,
  });

  onProgress(0.9, 'Starting sound checker…');
  const wasmPaths = opts.wasmPaths || new URL('../vendor/ort/', import.meta.url).href;

  // Prefer dedicated Web Worker in browser environments
  const canUseWorker =
    opts.useWorker !== false &&
    typeof Worker !== 'undefined' &&
    typeof window !== 'undefined';

  if (canUseWorker) {
    try {
      const workerUrl = new URL('./grade-worker.js', import.meta.url);
      const worker = new Worker(workerUrl);
      attachWorkerHandlers(worker);
      const workerBuf = modelAsset.buffer.slice(0);
      await callWorker(
        worker,
        { type: 'init', wasmPaths, modelBuffer: workerBuf },
        [workerBuf],
      );
      await initTrialEngine({
        worker,
        session: null,
        cachedBytes: modelAsset.byteLength,
        fromCache: modelAsset.fromCache,
        cacheSource: modelAsset.cacheSource,
      });
      onProgress(1, 'Ready');
      exposeGlobalPronounceApi();
      return runtime;
    } catch (workerErr) {
      console.warn('Web Worker init failed, falling back to single-thread WASM on main thread:', workerErr);
    }
  }

  const ort = opts.ort || globalThis.ort;
  if (!ort || !ort.InferenceSession) {
    throw new Error('onnxruntime-web is not loaded');
  }
  if (ort.env && ort.env.wasm) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths;
  }
  const session = await ort.InferenceSession.create(modelAsset.buffer, {
    executionProviders: ['wasm'],
  });
  session.ort = ort;
  await initTrialEngine({
    session,
    worker: null,
    cachedBytes: modelAsset.byteLength,
    fromCache: modelAsset.fromCache,
    cacheSource: modelAsset.cacheSource,
  });
  onProgress(1, 'Ready');
  exposeGlobalPronounceApi();
  return runtime;
}

/**
 * High-level helper for Day 4, Day 6, Phonics / Decodable Readers, and TOEIC Read-Aloud.
 */
export async function gradeAudioForApp(audioBlobOrSamples, targetText, opts = {}) {
  const appId = opts.appId || 'day4';
  const thresholds = getAppThresholds(appId);
  const passAt = typeof opts.passAt === 'number' ? opts.passAt : PASS_PCT;
  const samples = audioBlobOrSamples instanceof Float32Array
    ? audioBlobOrSamples
    : await decodeAudioToMono(audioBlobOrSamples, TARGET_SAMPLE_RATE);
  return gradeTrialSamples(samples, targetText, passAt, opts.hooks || null, {
    ...opts,
    appId,
  });
}

export function exposeGlobalPronounceApi() {
  if (typeof globalThis === 'undefined') return;
  globalThis.MRJ_PRONOUNCE = {
    modelId: MODEL_ID,
    license: 'Apache-2.0',
    thresholds: APP_THRESHOLDS,
    passPct: PASS_PCT,
    getAppThresholds,
    bandForScore,
    boot: bootTrialInPage,
    checkModelCached,
    gradeSamples: gradeTrialSamples,
    gradeAudio: gradeAudioForApp,
    expectedPhoneSequence,
    tokenizeWords,
    // App-specific entry points for Day 4, Day 6, Decodable Readers, and TOEIC Read-Aloud
    gradeDay4: (audio, text, opts) => gradeAudioForApp(audio, text, { ...opts, appId: 'day4' }),
    gradeDay6: (audio, text, opts) => gradeAudioForApp(audio, text, { ...opts, appId: 'day6' }),
    gradeDecodables: (audio, text, opts) => gradeAudioForApp(audio, text, { ...opts, appId: 'decodables' }),
    gradePhonics: (audio, text, opts) => gradeAudioForApp(audio, text, { ...opts, appId: 'phonics' }),
    gradeToeic: (audio, text, opts) => gradeAudioForApp(audio, text, { ...opts, appId: 'toeic' }),
  };
}

export {
  APP_THRESHOLDS,
  ARPABET_PHONES,
  BLANK_ID,
  FRAME_MS,
  MODEL_ID,
  VOCAB_SIZE,
  bandForScore,
  getAppThresholds,
  scoreUtteranceFromLogits,
};
