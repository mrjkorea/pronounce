import {
  loadG2P,
  expectedPhoneSequence,
  forcedAlignGop,
  aggregate,
  tokenizeWords,
  unknownWords,
} from './engine.js?v=20260930-words';
import { decodeAudioToMono, audioStats, normalizeForModel, trimSilence, capSpeechWindow } from './audio.js';
import { sheetLines } from './sheet.js';

const HEAR_BASE = 'https://mrjkorea.github.io/day4-speak/';
const LOCAL_HEAR = new Set([
  'audio/hear/it-is-here.mp3',
  'audio/hear/it-is-there.mp3',
]);
const PASS_SCORE = 0.6;
const MS_PER_WORD = 200;
const SCORE_KEY = 'day4-pronounce-scores-v2';
const CACHE_NAME = 'day4-wav2vec2-int8-v1';
const BOOK_ORDER = ['basic_a', 'basic_b', 'basic_c', 'int3a', 'int3b', 'int3c', 'int2a', 'int2b', 'int2c'];

const QUESTION_CODES = {
  HITW: 'How is the weather?',
  WCYD: 'What can you draw?',
  WDYW: 'What do you want?',
  WIMP: 'Where is my phone?',
  WDIIT: 'What day is it today?',
  'WTII(N)': 'What time is it?',
  WTII: 'What time is it?',
  WFDYL: 'What flavor do you like?',
  WITB: 'What is this bug?',
  HWIYN: 'How will I yell your name?',
  WGAYI: 'What grade are you in?',
  WFAT: 'What fruit are these?',
  WDYH: 'What do you have?',
};

const SILENCE_MS = 1200;
const SILENCE_GRACE_MS = 1600;
const SILENCE_CHECK_MS = 80;
const SILENCE_RMS = 0.008;
const MAX_RECORD_MS = 60000;

let ort = typeof window !== 'undefined' ? window.ort : null;
if (ort) {
  ort.env.wasm.wasmPaths = new URL('vendor/ort/', window.location.href).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
}

const appEl = typeof document !== 'undefined' ? document.getElementById('app') : null;
const modelLabel = typeof document !== 'undefined' ? document.getElementById('modelLabel') : null;
const modelFill = typeof document !== 'undefined' ? document.getElementById('modelFill') : null;
const modelTrack = typeof document !== 'undefined' ? document.getElementById('modelTrack') : null;

let books = [];
let byId = new Map();
let session = null;
let modelError = '';
let capture = null;
let silenceTimer = null;
let silenceNodes = null;
let gradingScoreKey = null;

function koreanCode(korean) {
  const m = String(korean || '').match(/^([A-Z0-9()]+)\?\s*/);
  return m ? m[1] : null;
}

function analyzeUnit(unit) {
  const items = unit.items;
  const codes = items.map((it) => koreanCode(it.korean));
  const coded = codes.filter(Boolean);
  const allSameCode = coded.length === items.length && coded.every((c) => c === coded[0]);
  const code = allSameCode ? coded[0] : null;
  if (code === 'ITA') return { mode: 'ita-rows' };
  if (code === 'CIPO') return { mode: 'cipo-rows' };
  if (code && code !== 'ITA' && QUESTION_CODES[code]) {
    return { mode: 'shared', question: QUESTION_CODES[code], code };
  }
  const titleQ = unit.title.trim().endsWith('?');
  const allAnswers = items.every((it) => !it.english.trim().endsWith('?'));
  if (titleQ && allAnswers) return { mode: 'shared', question: unit.title.trim(), code: null };
  return { mode: 'plain' };
}

function sharedScoreKey(bookId, unitId) {
  return `${bookId}__${unitId}__shared_question`;
}

function itaQuestion(item) {
  const alt = (item.alts || []).find((a) => String(a).trim().endsWith('?'));
  if (alt) return String(alt).trim();
  const en = item.english.trim();
  const m = en.match(/^It is (an?|a) (.+)$/i);
  if (m) return `Is this ${m[1]} ${m[2]}?`;
  return en;
}

function cipoAnswer(item) {
  const alt = (item.alts || []).find((a) => String(a).trim());
  return alt ? String(alt).trim() : '';
}

function hearAnswerRel(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `audio/hear/${slug}.mp3`;
}

function rowParts(item, unit) {
  const plan = analyzeUnit(unit);
  if (plan.mode === 'ita-rows') {
    return [
      { key: 'question', label: 'Question', english: itaQuestion(item), audio: null },
      { key: 'answer', label: 'Answer', english: item.english, audio: item.audio },
    ];
  }
  if (plan.mode === 'cipo-rows') {
    const ans = cipoAnswer(item);
    return [
      { key: 'question', label: 'Question', english: item.english.trim(), audio: item.audio },
      { key: 'answer', label: 'Answer', english: ans, audio: ans ? hearAnswerRel(ans) : item.audio },
    ];
  }
  if (plan.mode === 'shared') {
    return [{ key: 'answer', label: 'Answer', english: item.english, audio: item.audio }];
  }
  const en = item.english.trim();
  if (en.endsWith('?')) {
    return [{ key: 'line', label: 'Question', english: en, audio: item.audio }];
  }
  return [{ key: 'line', label: 'Answer', english: en, audio: item.audio }];
}

function scoreStorageKey(itemId, partKey) {
  return partKey === 'line' ? itemId : `${itemId}::${partKey}`;
}

function scoringTarget(english) {
  const toks = tokenizeWords(english);
  if (toks.length === 1) {
    const w = toks[0].display;
    return `${w} ${w} ${w}`;
  }
  return english;
}

function needsTripleHint(english) {
  return tokenizeWords(english).length === 1;
}

function questionAudioRel(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `audio/hear/questions/${slug}.mp3`;
}

function itemRowPassed(item, unit, scores) {
  const plan = analyzeUnit(unit);
  if (plan.mode === 'shared') {
    const sk = sharedScoreKey(unit._bookId, unit.id);
    if (!scores[sk] || !scores[sk].pass) return false;
  }
  return rowParts(item, unit).every((p) => {
    const key = scoreStorageKey(item.id, p.key);
    return scores[key] && scores[key].pass;
  });
}


// Jay 28SEP2026: ONE score book — pronounce grades log here too.
function logToOneBook(itemId, graded) {
  const auth = window.MRJ_AUTH;
  const who = auth && typeof auth.student === 'function' ? String(auth.student() || '').trim() : '';
  if (!window.MRJ_SCORES || !graded || !who || !itemId) return;
  window.MRJ_SCORES.post({
    student: who,
    program: 'pronounce',
    appName: 'MRJ Pronounce Day 4',
    source: 'pronounce',
    itemId: 'pronounce:' + itemId,
    itemType: 'pronunciation',
    scoreValue: Number(graded.scorePct || 0),
    scoreMax: 100,
    scorePct: Number(graded.scorePct || 0),
    correctness: graded.pass ? 'correct' : 'incorrect',
    metadata: { english: graded.english || '', weak: graded.weak || [] },
  });
}

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
    const units = data.units.map((u) => ({ ...u, _bookId: id }));
    return { id, label: (meta && meta.label) || data.label, units };
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

function linePassed(line, unit, scores) {
  if (line.kind === 'extra') {
    const saved = scores[line.id];
    return !!(saved && saved.pass);
  }
  return itemRowPassed(line.item, unit, scores);
}

function bookProgress(book) {
  const scores = loadScores();
  let n = 0;
  let pass = 0;
  for (const unit of book.units) {
    const lines = sheetLines(book.id, unit);
    n += lines.length;
    for (const line of lines) {
      if (linePassed(line, unit, scores)) pass += 1;
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
    const lines = sheetLines(book.id, unit);
    const passed = lines.filter((line) => linePassed(line, unit, scores)).length;
    return `<a class="unit" href="#/book/${book.id}/unit/${unit.id}">${unit.title}<small>${passed} / ${lines.length}</small></a>`;
  }).join('');
  appEl.innerHTML = `<a class="back" href="#/">← Books</a><h1>${book.label}</h1><p class="lead">Tap the unit you are studying.</p><div class="units">${rows}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wordChipsHtml(words) {
  if (!words || !words.length) return '';
  const chips = words.map((w) => {
    const pct = Math.round((w.score || 0) * 100);
    const cls = (w.score || 0) >= PASS_SCORE ? 'good' : 'bad';
    return `<span class="word-chip ${cls}" title="${pct}%">${escapeHtml(w.word)}</span>`;
  }).join('');
  return `<div class="chips">${chips}</div>`;
}

function englishRevealed(saved) {
  return !!(saved && saved.pass === false);
}

function englishCueHtml(english, className) {
  const triple = needsTripleHint(english) ? '<p class="triple-hint">Say it 3 times.</p>' : '';
  return `<p class="${className}">${escapeHtml(english)}</p>${triple}`;
}

function partResultHtml(saved) {
  if (!saved) return '';
  const verdict = saved.pass ? 'Pass' : 'Not yet';
  const cls = saved.pass ? 'pass' : 'fail';
  const pct = saved.scorePct != null ? saved.scorePct : Math.round((saved.score || 0) * 100);
  const reason = saved.reason ? `<p class="meta">${escapeHtml(saved.reason)}</p>` : '';
  const chips = englishRevealed(saved) ? wordChipsHtml(saved.words) : '';
  return `<div class="after show">
    <p class="verdict ${cls}">${verdict} · ${pct}</p>
    ${chips}
    ${reason}
  </div>`;
}

function renderSharedQuestion(bookId, unit, scores, ready) {
  const plan = analyzeUnit(unit);
  if (plan.mode !== 'shared') return '';
  const sk = sharedScoreKey(bookId, unit.id);
  const saved = scores[sk];
  const micLabel = ready ? 'Mic' : 'Wait';
  const doneCls = saved && saved.pass ? 'done' : '';
  const result = partResultHtml(saved);
  const gradingShared = gradingScoreKey === sk;
  const gradeBar = gradingShared ? '<div class="grade-bar shared-grade show"><div class="grade-fill"></div></div>' : '';
  const prompt = englishRevealed(saved) ? englishCueHtml(plan.question, 'en-prompt') : '';
  return `<section class="shared-q ${doneCls}" data-shared="${escapeHtml(sk)}">
    <p class="shared-note">이 질문을 한 번만 말하세요.</p>
    ${prompt}
    <button type="button" class="mic shared-mic" data-score-key="${escapeHtml(sk)}" data-grade-text="${escapeHtml(plan.question)}" data-audio-rel="${escapeHtml(questionAudioRel(plan.question))}" ${ready ? '' : 'disabled'}>${micLabel}</button>
    ${result}
    ${gradeBar}
  </section>`;
}

function hearSrc(rel) {
  if (!rel) return '';
  if (LOCAL_HEAR.has(rel)) return rel;
  return HEAR_BASE + rel;
}

function koHtml(korean, imageRel, local, extraHtml) {
  const src = imageRel ? (local ? imageRel : HEAR_BASE + imageRel) : '';
  const pic = src ? `<img class="row-pic" alt="" src="${escapeHtml(src)}">` : '';
  return `<div class="ko-wrap">${pic}<div class="ko-text"><div class="ko">${escapeHtml(korean)}</div>${extraHtml || ''}</div></div>`;
}

function lineParts(line, unit) {
  if (line.kind === 'extra') {
    return [{ key: 'line', label: 'Answer', english: line.english, audio: line.audio }];
  }
  const item = line.item || {
    id: line.id,
    korean: line.korean,
    english: line.english,
    audio: line.audio,
    image: line.image,
  };
  return rowParts(item, unit);
}

function lineArticleHtml(line, unit, index, scores, ready) {
  const item = line.item || {
    id: line.id,
    korean: line.korean,
    english: line.english,
    audio: line.audio,
    image: line.image,
  };
  const parts = lineParts(line, unit);
  const multi = parts.length > 1;
  const grading = gradingScoreKey && parts.some((p) => scoreStorageKey(item.id, p.key) === gradingScoreKey);
  const imageRel = line.image || item.image || '';
  const partBlocks = parts.map((p) => {
    const skey = scoreStorageKey(item.id, p.key);
    const saved = scores[skey];
    const micLabel = ready ? 'Mic' : 'Wait';
    const revealed = englishRevealed(saved);
    const cue = revealed ? englishCueHtml(p.english, 'part-text') : '';
    const audioRel = p.audio || questionAudioRel(p.english);
    const micBtn = `<button type="button" class="mic" data-score-key="${escapeHtml(skey)}" data-item-id="${escapeHtml(item.id)}" data-part-key="${escapeHtml(p.key)}" data-grade-text="${escapeHtml(p.english)}" data-audio-rel="${escapeHtml(audioRel)}" ${ready ? '' : 'disabled'}>${micLabel}</button>`;
    if (!multi) {
      return {
        main: koHtml(item.korean, imageRel, line.local, cue),
        micBtn,
        saved,
      };
    }
    const label = revealed ? `<div class="part-label">${escapeHtml(p.label)}</div>` : '';
    return `<div class="part" data-part="${escapeHtml(p.key)}">
      <div>
        ${label}
        ${cue}
        ${partResultHtml(saved)}
      </div>
      ${micBtn}
    </div>`;
  });
  let body;
  let tail = '';
  if (multi) {
    body = `<div class="row-parts">${koHtml(item.korean, imageRel, line.local)}${partBlocks.join('')}</div>`;
  } else {
    const single = partBlocks[0];
    body = `<div class="row-main">${single.main}</div>${single.micBtn}`;
    tail = partResultHtml(single.saved);
  }
  const gradeBar = grading ? '<div class="grade-bar show"><div class="grade-fill"></div></div>' : '';
  return `<article class="row" data-id="${escapeHtml(item.id)}">
    <div class="num">${index + 1}</div>
    ${body}
    ${tail}
    ${gradeBar}
  </article>`;
}

function renderSheet(bookId, unitId) {
  const book = byId.get(bookId);
  const unit = book && book.units.find((u) => u.id === unitId);
  if (!unit) { appEl.innerHTML = '<p class="lead">That unit is not here.</p>'; return; }
  const scores = loadScores();
  const ready = !!session;
  const shared = renderSharedQuestion(bookId, unit, scores, ready);
  const lines = sheetLines(bookId, unit);
  const rows = lines.map((line, index) => lineArticleHtml(line, unit, index, scores, ready)).join('');
  const wait = modelError
    ? `<p class="note">${escapeHtml(modelError)}</p>`
    : (ready ? '' : '<p class="note">The sound checker is still loading. Mic turns on when the bar finishes.</p>');
  appEl.innerHTML = `<a class="back" href="#/book/${book.id}">← ${escapeHtml(book.label)}</a><h1>${escapeHtml(unit.title)}</h1>${wait}<div class="sheet">${shared}${rows}</div>`;
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
      if (item) return { item, unit, book };
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

function disconnectSilenceNodes() {
  if (!silenceNodes) return;
  try { silenceNodes.src.disconnect(); } catch (_) {}
  try { silenceNodes.analyser.disconnect(); } catch (_) {}
  try { if (silenceNodes.sink) silenceNodes.sink.disconnect(); } catch (_) {}
  silenceNodes = null;
}

function stopSilenceWatch() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  disconnectSilenceNodes();
}

function startSilenceWatch(stream, ctx, onDone) {
  stopSilenceWatch();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    stopSilenceWatch();
    try { onDone(); } catch (e) { console.warn('silence onDone', e); }
  };
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    src.connect(analyser);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(ctx.destination);
    silenceNodes = { src, analyser, sink };
    const buf = new Uint8Array(analyser.fftSize);
    let quietMs = 0;
    let totalMs = 0;
    let spoke = false;
    const tick = () => {
      if (finished) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      totalMs += SILENCE_CHECK_MS;
      if (rms >= SILENCE_RMS) {
        spoke = true;
        quietMs = 0;
      } else if (totalMs > SILENCE_GRACE_MS && spoke) {
        quietMs += SILENCE_CHECK_MS;
      }
      if (quietMs >= SILENCE_MS || totalMs >= MAX_RECORD_MS || (!spoke && totalMs >= 12000)) {
        finish();
        return;
      }
      silenceTimer = setTimeout(tick, SILENCE_CHECK_MS);
    };
    silenceTimer = setTimeout(tick, SILENCE_CHECK_MS);
  } catch (e) {
    console.warn('startSilenceWatch failed', e);
    silenceTimer = setTimeout(finish, 5000);
  }
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
  return { ctx, src, proc, gain, chunks, stream };
}

async function stopCapture() {
  const rec = capture;
  capture = null;
  stopSilenceWatch();
  if (!rec) return null;
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
  const target = scoringTarget(english);
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
  const { phones, words } = expectedPhoneSequence(target);
  const phoneScores = forcedAlignGop(logits, phones, 0);
  const latencyMs = performance.now() - t0;
  const result = aggregate(
    target,
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
  const missing = unknownWords(target);
  const wordCount = tokenizeWords(target).length;
  const longEnough = trimmedStats.durationMs >= wordCount * MS_PER_WORD;
  const realSpeech = !trimmedStats.tooQuiet && longEnough && missing.length === 0;
  const score = result.overall.score || 0;
  let reason = '';
  if (missing.length) reason = 'Missing from the word list: ' + missing.join(', ');
  else if (trimmedStats.tooQuiet) reason = 'Too quiet. Say it again in a clear voice.';
  else if (!longEnough) reason = 'Too short. Say the whole English line.';
  else if (score < PASS_SCORE) reason = 'The sounds did not match. Loud noise does not pass.';
  const pass = score >= PASS_SCORE && realSpeech;
  const scorePct = Math.round(score * 100);
  return {
    score,
    scorePct,
    pass,
    weak: weakWords(result),
    reason: pass ? '' : reason,
    english: target,
    words: result.words || [],
  };
}

function noteScoreToAuth(itemId, scorePct) {
  const auth = window.MRJ_AUTH;
  if (!auth || typeof auth.noteScore !== 'function' || typeof auth.student !== 'function') return;
  const student = auth.student();
  if (!student || !student.id) return;
  auth.noteScore({
    program: 'pronounce',
    itemId,
    scoreValue: Math.round(scorePct),
    scoreMax: 100,
    scorePct: Math.round(scorePct),
  });
}

function playAudioUrl(url, times = 1) {
  return new Promise((resolve) => {
    let left = times;
    const playOnce = () => {
      if (left <= 0) { resolve(); return; }
      left -= 1;
      const audio = new Audio(url);
      audio.addEventListener('ended', () => playOnce());
      audio.addEventListener('error', () => playOnce());
      audio.play().catch(() => playOnce());
    };
    playOnce();
  });
}

async function playExpectedOnFail(gradeText, audioRel, pass) {
  if (pass || !audioRel) return;
  const url = hearSrc(audioRel);
  const plays = needsTripleHint(gradeText) ? 3 : 1;
  await playAudioUrl(url, plays);
}

async function stopAndGrade() {
  const meta = capture;
  const blob = await stopCapture();
  const scoreKey = meta && meta.scoreKey;
  const gradeText = meta && meta.gradeText;
  const audioRel = meta && meta.audioRel;
  const itemId = meta && meta.itemId;
  if (!scoreKey || !blob || !gradeText) return;
  gradingScoreKey = scoreKey;
  render();
  appEl.querySelectorAll('.mic').forEach((el) => { el.disabled = true; });
  try {
    const graded = await gradeBlob(blob, gradeText);
    const scores = loadScores();
    scores[scoreKey] = {
      score: graded.score,
      scorePct: graded.scorePct,
      pass: graded.pass,
      weak: graded.weak,
      reason: graded.reason,
      english: graded.english,
      words: graded.words,
      at: Date.now(),
    };
    saveScores(scores);
    if (itemId) {
      noteScoreToAuth(itemId, graded.scorePct);
      logToOneBook(itemId, graded);
    }
    await playExpectedOnFail(gradeText, audioRel, graded.pass);
  } catch (err) {
    const scores = loadScores();
    const reason = (err && err.code === 'too_short')
      ? 'Too short. Say the whole English line.'
      : 'Could not check that try. Say it again.';
    scores[scoreKey] = {
      score: 0,
      scorePct: 0,
      pass: false,
      weak: [],
      reason,
      english: scoringTarget(gradeText),
      words: [],
      at: Date.now(),
    };
    saveScores(scores);
    console.error(err);
    await playExpectedOnFail(gradeText, audioRel, false);
  }
  gradingScoreKey = null;
  render();
}

async function onMic(btn) {
  if (!session || capture) return;
  const scoreKey = btn.getAttribute('data-score-key');
  const gradeText = btn.getAttribute('data-grade-text');
  const audioRel = btn.getAttribute('data-audio-rel');
  const itemId = btn.getAttribute('data-item-id');
  if (!scoreKey || !gradeText) return;
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
  capture.scoreKey = scoreKey;
  capture.gradeText = gradeText;
  capture.audioRel = audioRel;
  capture.itemId = itemId || scoreKey;
  startSilenceWatch(stream, capture.ctx, () => {
    if (capture) stopAndGrade();
  });
  appEl.querySelectorAll('.mic').forEach((el) => {
    el.disabled = el !== btn;
    if (el === btn) { el.textContent = 'Listening…'; el.classList.add('live'); }
  });
}

function onHear(btn) {
  const rel = btn.getAttribute('data-audio');
  if (!rel) return;
  const audio = new Audio(hearSrc(rel));
  audio.play().catch((err) => console.error(err));
}

if (appEl) {
  appEl.addEventListener('click', (ev) => {
    const hear = ev.target.closest('.hear');
    if (hear) { onHear(hear); return; }
    const mic = ev.target.closest('.mic');
    if (mic) onMic(mic);
  });

  window.addEventListener('hashchange', () => {
    if (capture) stopCapture();
    gradingScoreKey = null;
    render();
  });

  loadContent().then(render).catch((err) => {
    appEl.innerHTML = '<p class="lead">Could not load the sheets.</p>';
    console.error(err);
  });
  bootModel();
}

export {
  PASS_SCORE,
  QUESTION_CODES,
  analyzeUnit,
  scoringTarget,
  rowParts,
  lineParts,
  lineArticleHtml,
  renderSharedQuestion,
  scoreStorageKey,
  sharedScoreKey,
  itaQuestion,
  cipoAnswer,
  itemRowPassed,
};
