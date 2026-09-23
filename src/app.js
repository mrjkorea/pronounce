import {
  loadG2P,
  expectedPhoneSequence,
  forcedAlignGop,
  aggregate,
  tokenizeWords,
  unknownWords,
} from './engine.js';
import { decodeAudioToMono, audioStats, normalizeForModel, trimSilence, capSpeechWindow } from './audio.js';

const HEAR_BASE = 'https://mrjkorea.github.io/day4-speak/';
const PASS_SCORE = 0.8;
const MS_PER_WORD = 200;
const SCORE_KEY = 'day4-pronounce-scores-v1';
const CACHE_NAME = 'day4-wav2vec2-int8-v1';
const BOOK_ORDER = ['basic_a', 'basic_b', 'basic_c', 'int3a', 'int3b', 'int3c', 'int2a', 'int2b', 'int2c'];

const ort = window.ort;
// Absolute folder URL. A bare "vendor/ort/" string is not a valid import() specifier.
ort.env.wasm.wasmPaths = new URL('vendor/ort/', window.location.href).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const appEl = document.getElementById('app');
const modelLabel = document.getElementById('modelLabel');
const modelFill = document.getElementById('modelFill');
const modelTrack = document.getElementById('modelTrack');

let books = [];
let byId = new Map();
let session = null;
let modelError = '';
let capture = null;

function loadScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveScores(scores) {
  localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
}

function setProgress(frac, text) {
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  modelFill.style.width = pct + '%';
  modelLabel.textContent = text;
}

function markModelReady() {
  modelLabel.classList.add('done');
  modelTrack.classList.add('done');
}

async function readBody(res, onChunk) {
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onChunk(value.byteLength);
  }
  const out = new Uint8Array(got);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function assembleModel(onProgress) {
  const cache = await caches.open(CACHE_NAME);
  const key = new Request(new URL('models/wav2vec2/model_int8.onnx', window.location.href).href);
  const hit = await cache.match(key);
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (buf.byteLength === 317712780) {
      onProgress(1);
      return buf;
    }
    await cache.delete(key);
  }
  const manifest = await fetch('models/wav2vec2/manifest.json').then((r) => {
    if (!r.ok) throw new Error('model manifest missing');
    return r.json();
  });
  const total = manifest.total;
  const parts = new Uint8Array(total);
  let offset = 0;
  let got = 0;
  for (const part of manifest.parts) {
    const res = await fetch('models/wav2vec2/' + part.name);
    if (!res.ok) throw new Error('missing ' + part.name);
    const bytes = await readBody(res, (n) => {
      got += n;
      onProgress(got / total);
    });
    if (bytes.byteLength !== part.bytes) throw new Error('bad size ' + part.name);
    parts.set(bytes, offset);
    offset += bytes.byteLength;
  }
  if (offset !== total || offset !== 317712780) throw new Error('model size mismatch');
  const buf = parts.buffer;
  await cache.put(key, new Response(buf.slice(0), {
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(total) },
  }));
  onProgress(1);
  return buf;
}

async function bootModel() {
  try {
    setProgress(0.02, 'Loading the sound checker…');
    const g2p = loadG2P('');
    const buf = await assembleModel((frac) => {
      setProgress(frac * 0.9, 'Downloading the sound checker… ' + Math.round(frac * 100) + '%');
    });
    setProgress(0.92, 'Starting the sound checker…');
    session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    if (new URLSearchParams(location.search).get('probe') === '1') {
      const silence = new Float32Array(1600);
      const out = await session.run({ input_values: new ort.Tensor('float32', silence, [1, 1600]) });
      document.documentElement.dataset.probe = out.logits.dims.join('x');
    }
    await g2p;
    setProgress(1, 'Ready');
    markModelReady();
    render();
  } catch (err) {
    modelError = err && err.message ? err.message : String(err);
    modelLabel.textContent = 'Sound checker did not start. ' + modelError;
    console.error(err);
    render();
  }
}

async function loadContent() {
  const manifest = await fetch('content/manifest.json').then((r) => r.json());
  const files = await Promise.all(BOOK_ORDER.map(async (id) => {
    const meta = manifest.books.find((b) => b.id === id);
    const data = await fetch('content/' + id + '.json').then((r) => r.json());
    return { id, label: (meta && meta.label) || data.label, units: data.units };
  }));
  books = files;
  byId = new Map(files.map((b) => [b.id, b]));
}

function route() {
  const hash = (location.hash || '#/').replace(/^#/, '');
  const unit = hash.match(/^\/book\/([a-z0-9_]+)\/unit\/([a-z0-9_]+)$/);
  if (unit) return { name: 'sheet', bookId: unit[1], unitId: unit[2] };
  const book = hash.match(/^\/book\/([a-z0-9_]+)$/);
  if (book) return { name: 'units', bookId: book[1] };
  return { name: 'home' };
}

function bookProgress(book) {
  const scores = loadScores();
  let n = 0;
  let pass = 0;
  for (const unit of book.units) {
    for (const item of unit.items) {
      n += 1;
      if (scores[item.id] && scores[item.id].pass) pass += 1;
    }
  }
  return { n, pass };
}

function renderHome() {
  const cards = books.map((book) => {
    const prog = bookProgress(book);
    return `<a class="book" href="#/book/${book.id}">${book.label}<small>${prog.pass} / ${prog.n} passed</small></a>`;
  }).join('');
  appEl.innerHTML = `<h1>Pronounce · Day 4</h1><p class="lead">Tap your book.</p><div class="books">${cards}</div>`;
}

function renderUnits(bookId) {
  const book = byId.get(bookId);
  if (!book) { appEl.innerHTML = '<p class="lead">That book is not here.</p>'; return; }
  const scores = loadScores();
  const rows = book.units.map((unit) => {
    const passed = unit.items.filter((item) => scores[item.id] && scores[item.id].pass).length;
    return `<a class="unit" href="#/book/${book.id}/unit/${unit.id}">${unit.title}<small>${passed} / ${unit.items.length}</small></a>`;
  }).join('');
  appEl.innerHTML = `<a class="back" href="#/">← Books</a><h1>${book.label}</h1><p class="lead">Tap the unit you are studying.</p><div class="units">${rows}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function resultHtml(saved) {
  if (!saved) return '';
  const verdict = saved.pass ? 'Pass' : 'Not yet';
  const cls = saved.pass ? 'pass' : 'fail';
  const weak = (saved.weak && saved.weak.length) ? saved.weak.join(', ') : 'none';
  const reason = saved.reason ? `<p class="meta">${escapeHtml(saved.reason)}</p>` : '';
  return `<div class="after show">
    <p class="verdict ${cls}">${verdict} · ${Number(saved.score).toFixed(2)}</p>
    <p class="meta">Weak words: ${escapeHtml(weak)}</p>
    ${reason}
    <p class="english">English: <b>${escapeHtml(saved.english)}</b></p>
    <button type="button" class="hear" data-audio="${escapeHtml(saved.audio)}">Hear</button>
  </div>`;
}

function renderSheet(bookId, unitId) {
  const book = byId.get(bookId);
  const unit = book && book.units.find((u) => u.id === unitId);
  if (!unit) { appEl.innerHTML = '<p class="lead">That unit is not here.</p>'; return; }
  const scores = loadScores();
  const ready = !!session;
  const rows = unit.items.map((item) => {
    const saved = scores[item.id];
    const micLabel = ready ? 'Mic' : 'Wait';
    return `<article class="row" data-id="${escapeHtml(item.id)}">
      <div class="num">${item.n}</div>
      <div class="ko">${escapeHtml(item.korean)}</div>
      <button type="button" class="mic" data-id="${escapeHtml(item.id)}" ${ready ? '' : 'disabled'}>${micLabel}</button>
      ${resultHtml(saved)}
    </article>`;
  }).join('');
  const wait = modelError
    ? `<p class="note">${escapeHtml(modelError)}</p>`
    : (ready ? '' : '<p class="note">The sound checker is still loading. Mic turns on when the bar finishes.</p>');
  appEl.innerHTML = `<a class="back" href="#/book/${book.id}">← ${escapeHtml(book.label)}</a><h1>${escapeHtml(unit.title)}</h1>${wait}<div class="sheet">${rows}</div>`;
}

function render() {
  if (!books.length) {
    appEl.innerHTML = '<p class="lead">Loading the sheets…</p>';
    return;
  }
  const r = route();
  if (r.name === 'units') renderUnits(r.bookId);
  else if (r.name === 'sheet') renderSheet(r.bookId, r.unitId);
  else renderHome();
}

function findItem(id) {
  for (const book of books) {
    for (const unit of book.units) {
      const item = unit.items.find((it) => it.id === id);
      if (item) return item;
    }
  }
  return null;
}

function encodeWav(floatChunks, sampleRate) {
  let len = 0;
  for (const c of floatChunks) len += c.length;
  const samples = new Float32Array(len);
  let o = 0;
  for (const c of floatChunks) { samples.set(c, o); o += c.length; }
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const wstr = (s, p) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  wstr('RIFF', 0); v.setUint32(4, 36 + samples.length * 2, true);
  wstr('WAVE', 8); wstr('fmt ', 12);
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr('data', 36); v.setUint32(40, samples.length * 2, true);
  let p = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    p += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function startCapture(stream) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const chunks = [];
  proc.onaudioprocess = (e) => {
    if (!capture) return;
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  src.connect(proc);
  proc.connect(gain);
  gain.connect(ctx.destination);
  const timer = setTimeout(() => { if (capture) stopAndGrade(); }, 8000);
  return { ctx, src, proc, gain, chunks, stream, timer };
}

async function stopCapture() {
  const rec = capture;
  capture = null;
  if (!rec) return null;
  clearTimeout(rec.timer);
  try { rec.proc.disconnect(); rec.src.disconnect(); rec.gain.disconnect(); } catch (_) {}
  rec.stream.getTracks().forEach((t) => t.stop());
  const rate = rec.ctx.sampleRate || 48000;
  const blob = encodeWav(rec.chunks, rate);
  rec.ctx.close().catch(() => {});
  return blob;
}

function weakWords(result) {
  return (result.words || []).filter((w) => (w.score || 0) < PASS_SCORE).map((w) => w.word);
}

async function gradeBlob(blob, english) {
  const t0 = performance.now();
  const samples = await decodeAudioToMono(blob, 16000);
  const stats = audioStats(samples, 16000);
  if (stats.durationMs < 80) {
    const err = new Error('too_short');
    err.code = 'too_short';
    throw err;
  }
  const trimmed = capSpeechWindow(trimSilence(samples, 16000, 0.006, 80), 16000, 4500);
  const trimmedStats = audioStats(trimmed, 16000);
  const input = normalizeForModel(trimmed);
  const feeds = { input_values: new ort.Tensor('float32', input, [1, input.length]) };
  const results = await session.run(feeds);
  const logitsArr = results.logits.data;
  const T = results.logits.dims[1];
  const V = results.logits.dims[2];
  const logits = new Array(T);
  for (let t = 0; t < T; t++) logits[t] = logitsArr.subarray(t * V, (t + 1) * V);
  const { phones, words } = expectedPhoneSequence(english);
  const phoneScores = forcedAlignGop(logits, phones, 0);
  const latencyMs = performance.now() - t0;
  const result = aggregate(
    english,
    words,
    phoneScores,
    trimmedStats.durationMs,
    16000,
    'wav2vec2-lv-60-espeak-cv-ft-onnx-int8',
    latencyMs,
    {
      clipping: stats.clipping,
      too_quiet: trimmedStats.tooQuiet,
      snr_est: trimmedStats.snrEst,
      warnings: trimmedStats.tooQuiet ? ['audio_too_quiet'] : [],
    },
  );
  const missing = unknownWords(english);
  const wordCount = tokenizeWords(english).length;
  const longEnough = trimmedStats.durationMs >= wordCount * MS_PER_WORD;
  const realSpeech = !trimmedStats.tooQuiet && longEnough && missing.length === 0;
  const score = result.overall.score || 0;
  let reason = '';
  if (missing.length) reason = 'Missing from the word list: ' + missing.join(', ');
  else if (trimmedStats.tooQuiet) reason = 'Too quiet. Say it again in a clear voice.';
  else if (!longEnough) reason = 'Too short. Say the whole English line.';
  else if (score < PASS_SCORE) reason = 'The sounds did not match. Loud noise does not pass.';
  const pass = score >= PASS_SCORE && realSpeech;
  return {
    score,
    pass,
    weak: weakWords(result),
    reason: pass ? '' : reason,
    english,
  };
}

async function stopAndGrade() {
  const itemId = capture && capture.itemId;
  const blob = await stopCapture();
  if (!itemId || !blob) return;
  const item = findItem(itemId);
  const btn = appEl.querySelector(`.mic[data-id="${CSS.escape(itemId)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const graded = await gradeBlob(blob, item.english);
    const scores = loadScores();
    scores[item.id] = {
      score: graded.score,
      pass: graded.pass,
      weak: graded.weak,
      reason: graded.reason,
      english: item.english,
      audio: item.audio,
      at: Date.now(),
    };
    saveScores(scores);
  } catch (err) {
    const scores = loadScores();
    const reason = (err && err.code === 'too_short')
      ? 'Too short. Say the whole English line.'
      : 'Could not check that try. Say it again.';
    scores[item.id] = {
      score: 0,
      pass: false,
      weak: [],
      reason,
      english: item.english,
      audio: item.audio,
      at: Date.now(),
    };
    saveScores(scores);
    console.error(err);
  }
  render();
}

async function onMic(btn) {
  if (!session) return;
  const itemId = btn.getAttribute('data-id');
  if (capture) {
    if (capture.itemId === itemId) await stopAndGrade();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    modelLabel.classList.remove('done');
    modelLabel.textContent = 'The microphone is blocked. Allow the mic and tap again.';
    console.error(err);
    return;
  }
  capture = startCapture(stream);
  capture.itemId = itemId;
  appEl.querySelectorAll('.mic').forEach((el) => {
    el.disabled = el !== btn;
    if (el === btn) { el.textContent = 'Stop'; el.classList.add('live'); }
  });
}

function onHear(btn) {
  const rel = btn.getAttribute('data-audio');
  if (!rel) return;
  const audio = new Audio(HEAR_BASE + rel);
  audio.play().catch((err) => console.error(err));
}

appEl.addEventListener('click', (ev) => {
  const hear = ev.target.closest('.hear');
  if (hear) { onHear(hear); return; }
  const mic = ev.target.closest('.mic');
  if (mic) onMic(mic);
});

window.addEventListener('hashchange', () => {
  if (capture) stopCapture();
  render();
});

loadContent().then(render).catch((err) => {
  appEl.innerHTML = '<p class="lead">Could not load the sheets.</p>';
  console.error(err);
});
bootModel();
