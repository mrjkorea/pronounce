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
import {
  FLOW_STORAGE_KEY,
  LOCK_TEXT,
  advanceFlow,
  canStartMic,
  isLocked,
  lineOpenFor,
  markRushRecorded,
  normalizeFlow,
  noteAttempt,
  noteRushGrade,
  noteTeacherPass,
  reconcileFlow,
  resultsView,
  startTimer,
  stopTimer,
  sumWords,
  timerRunning,
  timerSeconds,
  tryTeacherPassword,
} from './flow.js?v=20261007-authpack';

import {
  PROGRAM,
  REMOTE_SAVE_MIN_MS,
  authStudentId,
  mergeScoreMaps,
  packLoadAllowsSave,
  parsePackJson,
  progressRowsToScores,
  migrateLegacyScoresReadOnly,
  studentScoreStorageKey,
} from './progress-merge.js?v=20261007-authpack';

const HEAR_BASE = 'https://mrjkorea.github.io/day4-speak/';
const LOCAL_HEAR = new Set([
  'audio/hear/it-is-here.mp3',
  'audio/hear/it-is-there.mp3',
]);
const PASS_SCORE = 0.6;
const MS_PER_WORD = 200;
let activeStudentKey = '';
const remoteSync = {
  packLoadOk: false,
  saveTimer: null,
  flushPending: false,
  lastSaveAt: 0,
  inFlight: false,
};
const LANG_KEY = 'day4-ui-lang';
const UI_LANGS = [
  ['en', 'English'],
  ['ko', '한국어'],
  ['zh-Hans', '中文'],
  ['ja', '日本語'],
  ['es', 'Español'],
  ['hi', 'हिन्दी'],
  ['de', 'Deutsch'],
  ['vi', 'Tiếng Việt'],
  ['pt-BR', 'Português'],
  ['id', 'Bahasa Indonesia'],
  ['fr', 'Français'],
  ['ar', 'العربية'],
  ['tr', 'Türkçe'],
  ['it', 'Italiano'],
  ['pl', 'Polski'],
];
let l1Pack = null;
const WASM_THREADS = 1;
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
const PART2_SILENCE_MS = 400;
const SILENCE_CHECK_MS = 80;
const SILENCE_RMS = 0.08;
const MAX_RECORD_MS = 60000;

const appEl = typeof document !== 'undefined' ? document.getElementById('app') : null;
const modelLabel = typeof document !== 'undefined' ? document.getElementById('modelLabel') : null;
const modelFill = typeof document !== 'undefined' ? document.getElementById('modelFill') : null;
const modelTrack = typeof document !== 'undefined' ? document.getElementById('modelTrack') : null;

let books = [];
let byId = new Map();
let gradeWorker = null;
let checkerReady = false;
let modelError = '';
let capture = null;
let silenceTimer = null;
let silenceNodes = null;
let gradingScoreKey = null;
let gradeEpoch = 0;
let part1Busy = false;
let rushInFlight = 0;
const rushChecking = new Map();
let logitSeq = 0;
const logitWaiters = new Map();
let chainTail = Promise.resolve();
let scoreTail = Promise.resolve();
let clockTimer = null;
let teacherMiss = {};

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
  if (!activeStudentKey) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(activeStudentKey) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveScores(scores) {
  if (!activeStudentKey) return;
  localStorage.setItem(activeStudentKey, JSON.stringify(scores));
  schedulePackSave();
}

function clearRemoteSaveTimer() {
  if (remoteSync.saveTimer) {
    clearTimeout(remoteSync.saveTimer);
    remoteSync.saveTimer = null;
  }
}

function schedulePackSave(delayMs) {
  if (!remoteSync.packLoadOk || remoteSync.inFlight) return;
  const auth = window.MRJ_AUTH;
  if (!auth || typeof auth.savePack !== 'function' || !auth.packReady || !auth.packReady(PROGRAM)) return;
  clearRemoteSaveTimer();
  const now = Date.now();
  const wait = delayMs != null
    ? delayMs
    : Math.max(0, REMOTE_SAVE_MIN_MS - (now - remoteSync.lastSaveAt));
  remoteSync.saveTimer = setTimeout(() => {
    remoteSync.saveTimer = null;
    void flushPackSave(false);
  }, wait);
}

async function flushPackSave(force) {
  if (!remoteSync.packLoadOk) return;
  const auth = window.MRJ_AUTH;
  if (!auth || typeof auth.savePack !== 'function' || !auth.packReady || !auth.packReady(PROGRAM)) return;
  const now = Date.now();
  if (!force && now - remoteSync.lastSaveAt < REMOTE_SAVE_MIN_MS) {
    schedulePackSave();
    return;
  }
  if (remoteSync.inFlight) {
    remoteSync.flushPending = true;
    return;
  }
  remoteSync.inFlight = true;
  try {
    const payload = JSON.stringify(loadScores());
    const res = await auth.savePack(PROGRAM, payload);
    if (res && res.ok) remoteSync.lastSaveAt = Date.now();
  } catch (err) {
    console.error(err);
  } finally {
    remoteSync.inFlight = false;
    if (remoteSync.flushPending) {
      remoteSync.flushPending = false;
      void flushPackSave(true);
    }
  }
}

async function syncScoresFromServer(detail) {
  const auth = window.MRJ_AUTH;
  if (!auth) return;
  const studentId = authStudentId(typeof auth.student === 'function' ? auth.student() : '');
  const nextKey = studentScoreStorageKey(studentId);
  if (!studentId) {
    activeStudentKey = '';
    remoteSync.packLoadOk = false;
    return;
  }
  activeStudentKey = nextKey;
  remoteSync.packLoadOk = false;
  clearRemoteSaveTimer();
  migrateLegacyScoresReadOnly(localStorage, studentId);
  let local = loadScores();

  let packResult = null;
  if (typeof auth.loadPack === 'function') {
    packResult = await auth.loadPack(PROGRAM);
  }
  if (packLoadAllowsSave(packResult)) {
    remoteSync.packLoadOk = true;
    const parsed = parsePackJson(packResult.progress_json);
    local = mergeScoreMaps(local, parsed.scores);
  }

  let progressRows = [];
  if (typeof auth.loadProgressForApp === 'function') {
    const prog = await auth.loadProgressForApp(PROGRAM);
    if (prog && prog.ok && Array.isArray(prog.progress)) progressRows = prog.progress;
  } else if (detail && Array.isArray(detail.progress)) {
    progressRows = detail.progress;
  }
  local = mergeScoreMaps(local, progressRowsToScores(progressRows));

  if (activeStudentKey) {
    localStorage.setItem(activeStudentKey, JSON.stringify(local));
    if (remoteSync.packLoadOk) {
      remoteSync.lastSaveAt = 0;
      schedulePackSave(0);
    }
  }
  if (appEl) render();
}

function onAuthReady(ev) {
  const detail = ev && ev.detail ? ev.detail : {};
  if (typeof window.MRJ_AUTH?.progressError === 'function' && window.MRJ_AUTH.progressError()) {
    // Progress book failed; keep local data and still try pack sync below.
  }
  void syncScoresFromServer(detail);
}

function flowKey(bookId, unitId) {
  return bookId + '/' + unitId;
}

function loadFlowBook() {
  try {
    const raw = JSON.parse(localStorage.getItem(FLOW_STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function loadUnitFlow(bookId, unitId) {
  return normalizeFlow(loadFlowBook()[flowKey(bookId, unitId)]);
}

function saveUnitFlow(bookId, unitId, flow) {
  const all = loadFlowBook();
  all[flowKey(bookId, unitId)] = flow;
  localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(all));
}

function chain(fn) {
  const next = chainTail.then(fn, fn);
  chainTail = next.then(() => {}, () => {});
  return next;
}

function enqueueScore(fn) {
  const next = scoreTail.then(fn, fn);
  scoreTail = next.then(() => {}, () => {});
  return next;
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

function onWorkerMessage(ev) {
  const msg = ev.data || {};
  if (msg.type === 'ready') {
    if (msg.numThreads !== WASM_THREADS) {
      modelError = 'Sound checker started with the wrong thread count.';
      modelLabel.textContent = modelError;
      return;
    }
    checkerReady = true;
    return;
  }
  if (msg.type === 'logits') {
    const waiter = logitWaiters.get(msg.id);
    if (!waiter) return;
    logitWaiters.delete(msg.id);
    waiter.resolve(msg);
    return;
  }
  if (msg.type === 'error') {
    const waiter = msg.id && logitWaiters.get(msg.id);
    if (waiter) {
      logitWaiters.delete(msg.id);
      waiter.reject(new Error(msg.message || 'sound checker failed'));
      return;
    }
    modelError = msg.message || 'Sound checker did not start.';
  }
}

function requestLogits(samples) {
  const id = ++logitSeq;
  const input = new Float32Array(samples);
  return new Promise((resolve, reject) => {
    logitWaiters.set(id, { resolve, reject });
    gradeWorker.postMessage({ type: 'run', id, input }, [input.buffer]);
  });
}

function startGradeWorker(modelBuffer) {
  gradeWorker = new Worker(new URL('./grade-worker.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const onReady = (ev) => {
      onWorkerMessage(ev);
      if (checkerReady) {
        gradeWorker.removeEventListener('message', onReady);
        gradeWorker.addEventListener('message', onWorkerMessage);
        resolve();
      } else if (modelError) {
        reject(new Error(modelError));
      }
    };
    gradeWorker.addEventListener('message', onReady);
    gradeWorker.addEventListener('error', () => {
      reject(new Error('sound checker worker failed'));
    });
    const wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
    gradeWorker.postMessage({
      type: 'init',
      model: modelBuffer,
      wasmPaths,
      numThreads: WASM_THREADS,
    }, [modelBuffer]);
  });
}

async function bootModel() {
  try {
    setProgress(0.02, 'Loading the sound checker…');
    const g2p = loadG2P('');
    const buf = await assembleModel((frac) => {
      setProgress(frac * 0.9, 'Downloading the sound checker… ' + Math.round(frac * 100) + '%');
    });
    setProgress(0.92, 'Starting the sound checker…');
    await startGradeWorker(buf);
    if (new URLSearchParams(location.search).get('probe') === '1') {
      const silence = new Float32Array(1600);
      const out = await requestLogits(silence);
      document.documentElement.dataset.probe = out.dims.join('x');
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

function currentLang() {
  const code = localStorage.getItem(LANG_KEY) || 'ko';
  return UI_LANGS.some(([id]) => id === code) ? code : 'ko';
}

function applyLangDir() {
  const code = currentLang();
  document.documentElement.lang = code;
  document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
}

function fillLangMenu() {
  const sel = document.getElementById('langMenu');
  if (!sel) return;
  const cur = currentLang();
  sel.innerHTML = UI_LANGS.map(([code, name]) => (
    `<option value="${code}"${code === cur ? ' selected' : ''}>${name}</option>`
  )).join('');
}

function lineCue(item) {
  if (!item) return '';
  const lang = currentLang();
  if (lang === 'ko') return item.korean || '';
  const row = l1Pack && l1Pack.lines && l1Pack.lines[item.id];
  if (row && row[lang]) return row[lang];
  return item.korean || '';
}

function questionCue(english) {
  const lang = currentLang();
  const row = l1Pack && l1Pack.questions && l1Pack.questions[english];
  if (row && row[lang]) return row[lang];
  return lang === 'en' ? english : '';
}

function noteCue() {
  const lang = currentLang();
  const note = l1Pack && l1Pack.note;
  if (note && note[lang]) return note[lang];
  return lang === 'ko' ? '이 질문을 한 번만 말하세요.' : 'Say this question one time.';
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
  return !!(saved && (saved.pass === true || saved.pass === false));
}

function shownGrade(view, key, saved) {
  if (view && view.rush) return (view.rushGrades && view.rushGrades[key]) || null;
  if (view && view.forceHideEnglish) return null;
  return saved || null;
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

function micButtonHtml(skey, itemId, partKey, english, audioRel, allowed, ready, label) {
  const live = !!(capture && capture.scoreKey === skey);
  const text = live ? 'Listening…' : (label && label !== 'Mic' ? label : (ready ? 'Mic' : 'Wait'));
  const itemAttr = itemId ? ` data-item-id="${escapeHtml(itemId)}"` : '';
  const partAttr = partKey ? ` data-part-key="${escapeHtml(partKey)}"` : '';
  const enabled = live || (allowed && ready);
  const cls = live ? 'mic live' : 'mic';
  const stop = live ? '<button type="button" class="take-stop">Stop</button>' : '';
  return `<button type="button" class="${cls}" data-score-key="${escapeHtml(skey)}"${itemAttr}${partAttr} data-grade-text="${escapeHtml(english)}" data-audio-rel="${escapeHtml(audioRel)}" ${enabled ? '' : 'disabled'}>${text}</button>${stop}`;
}

function askHtml(show) {
  if (!show) return '';
  const text = LOCK_TEXT === 'Please ask your teacher for help.' ? LOCK_TEXT : 'Please ask your teacher for help.';
  return `<p class="ask-teacher">${escapeHtml(text)}</p>`;
}

function beginRushCheck(id) {
  rushChecking.set(id, (rushChecking.get(id) || 0) + 1);
}

function endRushCheck(id) {
  const left = (rushChecking.get(id) || 1) - 1;
  if (left <= 0) rushChecking.delete(id);
  else rushChecking.set(id, left);
}

function rushMark(flow, id) {
  if (rushChecking.get(id)) return 'checking';
  const grade = flow.rushGrades && flow.rushGrades[id];
  if (!grade) return '';
  return grade.pass ? 'pass' : 'fail';
}

function checkHtml(mark) {
  if (mark === 'pass') return '<span class="got-it" aria-label="Pass">✓</span>';
  if (mark === 'fail') return '<span class="not-yet" aria-label="Not yet"><span class="rush-x" aria-hidden="true">✗</span> Not yet</span>';
  if (mark === 'checking') return '<span class="rush-checking">Checking</span>';
  return '';
}

function renderSharedQuestion(bookId, unit, scores, ready, view) {
  const plan = analyzeUnit(unit);
  if (plan.mode !== 'shared') return '';
  view = view || {};
  const sk = sharedScoreKey(bookId, unit.id);
  const saved = scores[sk];
  const allowed = view.allow ? !!view.allow[sk] : !!ready;
  const shown = shownGrade(view, sk, saved);
  const revealed = englishRevealed(shown);
  const prompt = revealed ? englishCueHtml(plan.question, 'en-prompt') : '';
  const rushMarks = view.rush && revealed ? wordChipsHtml(shown.words) : '';
  const meaning = questionCue(plan.question);
  const meaningHtml = meaning ? `<p class="l1-prompt">${escapeHtml(meaning)}</p>` : '';
  const result = view.hideVerdict ? '' : partResultHtml(saved);
  const gradingShared = gradingScoreKey === sk && !view.hideVerdict;
  const gradeBar = gradingShared ? '<div class="grade-bar shared-grade show"><div class="grade-fill"></div></div>' : '';
  const doneCls = saved && saved.pass ? 'done' : '';
  const mic = micButtonHtml(sk, '', '', plan.question, questionAudioRel(plan.question), allowed, ready, view.micLabel);
  return `<section class="shared-q ${doneCls}" data-shared="${escapeHtml(sk)}">
    <p class="shared-note">${escapeHtml(noteCue())}</p>
    ${meaningHtml}
    ${prompt}
    ${rushMarks}
    <div class="mic-cell">${checkHtml(view.marks && view.marks[sk])}${mic}</div>
    ${askHtml(view.locked && view.locked[sk])}
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

function lineArticleHtml(line, unit, index, scores, ready, view) {
  view = view || {};
  const item = line.item || {
    id: line.id,
    korean: line.korean,
    english: line.english,
    audio: line.audio,
    image: line.image,
  };
  const parts = lineParts(line, unit);
  const multi = parts.length > 1;
  const grading = !view.hideVerdict && gradingScoreKey && parts.some((p) => scoreStorageKey(item.id, p.key) === gradingScoreKey);
  const imageRel = line.image || item.image || '';
  const partBlocks = parts.map((p) => {
    const skey = scoreStorageKey(item.id, p.key);
    const saved = scores[skey];
    const allowed = view.allow ? !!view.allow[skey] : !!ready;
    const shown = shownGrade(view, skey, saved);
    const revealed = englishRevealed(shown);
    const cue = revealed ? englishCueHtml(p.english, 'part-text') : '';
    const rushMarks = view.rush && revealed ? wordChipsHtml(shown.words) : '';
    const audioRel = p.audio || questionAudioRel(p.english);
    const micBtn = micButtonHtml(skey, item.id, p.key, p.english, audioRel, allowed, ready, view.micLabel);
    const recorded = checkHtml(view.marks && view.marks[skey]);
    const ask = askHtml(view.locked && view.locked[skey]);
    const result = view.hideVerdict ? '' : partResultHtml(saved);
    if (!multi) {
      return {
        main: koHtml(lineCue(item), imageRel, line.local, cue + rushMarks + ask),
        micBtn: recorded + micBtn,
        saved,
        result,
      };
    }
    const label = revealed ? `<div class="part-label">${escapeHtml(p.label)}</div>` : '';
    return `<div class="part" data-part="${escapeHtml(p.key)}">
      <div>
        ${label}
        ${cue}
        ${rushMarks}
        ${ask}
        ${result}
      </div>
      <div class="mic-cell">${recorded}${micBtn}</div>
    </div>`;
  });
  let body;
  let tail = '';
  if (multi) {
    body = `<div class="row-parts">${koHtml(lineCue(item), imageRel, line.local)}${partBlocks.join('')}</div>`;
  } else {
    const single = partBlocks[0];
    body = `<div class="row-main">${single.main}</div><div class="mic-cell">${single.micBtn}</div>`;
    tail = single.result;
  }
  const gradeBar = grading ? '<div class="grade-bar show"><div class="grade-fill"></div></div>' : '';
  return `<article class="row" data-id="${escapeHtml(item.id)}">
    <div class="num">${index + 1}</div>
    ${body}
    ${tail}
    ${gradeBar}
  </article>`;
}

function speakTargets(bookId, unit) {
  const out = [];
  const plan = analyzeUnit(unit);
  if (plan.mode === 'shared') {
    out.push({
      id: sharedScoreKey(bookId, unit.id),
      english: plan.question,
      korean: '이 질문을 한 번만 말하세요.',
      image: '',
      local: false,
      audio: questionAudioRel(plan.question),
      itemId: '',
      partKey: 'shared',
      shared: true,
    });
  }
  const lines = sheetLines(bookId, unit);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = lineParts(line, unit);
    const item = line.item || {
      id: line.id,
      korean: line.korean,
      english: line.english,
      audio: line.audio,
      image: line.image,
    };
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      out.push({
        id: scoreStorageKey(item.id, part.key),
        english: part.english,
        korean: item.korean,
        image: line.image || item.image || '',
        local: !!line.local,
        audio: part.audio || questionAudioRel(part.english),
        itemId: item.id,
        partKey: part.key,
        shared: false,
        line,
      });
    }
  }
  return out;
}

function speakWordCount(bookId, unit) {
  return sumWords(speakTargets(bookId, unit).map((target) => target.english));
}

function sheetView(flow, targets) {
  const allow = {};
  const locked = {};
  const marks = {};
  const running = timerRunning(flow);
  for (let i = 0; i < targets.length; i++) {
    const id = targets[i].id;
    allow[id] = checkerReady && canStartMic({
      phase: flow.phase,
      recording: false,
      timerRunning: running,
      lineOpen: lineOpenFor(flow, id),
    });
    if (flow.phase === 'part1' && isLocked(flow, id)) locked[id] = true;
    if (flow.phase === 'part2' || flow.phase === 'results') marks[id] = rushMark(flow, id);
  }
  const rush = flow.phase === 'part2' || flow.phase === 'results';
  return {
    allow,
    locked,
    marks,
    rush,
    rushGrades: flow.rushGrades || {},
    forceHideEnglish: flow.phase !== 'part1',
    hideVerdict: rush,
    micLabel: flow.phase === 'teacher' ? 'Teacher mic' : 'Mic',
  };
}

function clockSeconds(flow, now) {
  const limit = flow.part2.limitSec || 60;
  if (!flow.part2.startedAt || flow.part2.stoppedAt || flow.phase === 'results') return limit;
  const leftMs = limit * 1000 - (now - flow.part2.startedAt);
  return Math.max(0, Math.ceil(leftMs / 1000));
}

function resultsHtml(flow, targets) {
  const view = resultsView(flow, targets);
  const skips = view.skipped.map((line) => `<p class="skip-line">${escapeHtml(line.label)} <b>skipped</b></p>`).join('');
  const said = view.teacherSaid.map((line) => `<p class="teacher-line">${escapeHtml(line.label)} <b>teacher</b></p>`).join('');
  return `<section class="part-results">
    <h2>Results</h2>
    <p>Seconds used: ${view.secondsUsed}. Limit ${view.limitSec}.</p>
    <p>Part 2 pronunciation: ${view.rushPassed} passed</p>
    <p>Part 1 pronunciation: ${view.passed} passed</p>
    ${skips}
    ${said}
  </section>`;
}

function rushBarHtml(flow) {
  const limit = flow.part2.limitSec || timerSecondsSafe(flow);
  const started = !!flow.part2.startedAt && !flow.part2.stoppedAt && flow.phase === 'part2';
  const showStart = flow.phase === 'part2' && !flow.part2.startedAt;
  const clock = flow.phase === 'results' ? '0' : String(started ? clockSeconds(flow, Date.now()) : limit);
  const banner = flow.phase === 'part2' ? '<p class="rush-banner">Part 2 · Timer</p>' : '';
  return `<section class="rush">
    ${banner}
    <p class="rush-limit">Limit ${limit} seconds</p>
    <p class="rush-clock" id="rushClock">${clock}</p>
    ${showStart ? `<button type="button" id="rushStart" ${checkerReady ? '' : 'disabled'}>Start</button>` : ''}
    ${started ? '<button type="button" id="rushStop">Stop</button>' : ''}
  </section>`;
}

function timerSecondsSafe(flow) {
  return flow.part2.limitSec === 90 ? 90 : 60;
}

function teacherMeaning(target) {
  if (!target.shared) return '';
  const meaning = questionCue(target.english);
  const meaningHtml = meaning ? `<p class="l1-prompt">${escapeHtml(meaning)}</p>` : '';
  return `<p class="shared-note">${escapeHtml(noteCue())}</p>${meaningHtml}`;
}

function teacherKorean(target) {
  if (target.shared) return '';
  return lineCue({
    id: target.itemId || target.id,
    korean: target.korean || '',
  });
}

function teacherBlockHtml(targets, ready, flow) {
  const stuck = targets.filter((target) => lineOpenFor(flow, target.id));
  const rows = stuck.map((target) => {
    const miss = teacherMiss[target.id] ? '<p class="verdict fail">Not yet</p>' : '';
    const allowed = checkerReady && canStartMic({
      phase: 'teacher',
      recording: false,
      timerRunning: false,
      lineOpen: true,
    });
    const mic = micButtonHtml(target.id, target.itemId, target.partKey, target.english, target.audio, allowed, ready, 'Teacher mic');
    return `<article class="row teacher-row" data-id="${escapeHtml(target.id)}">
      ${koHtml(teacherKorean(target), target.image, target.local, teacherMeaning(target))}
      <div class="mic-cell">${mic}</div>
      ${miss}
    </article>`;
  }).join('');
  return `<form id="teacherGate" class="teacher-gate" method="post" action="#/" autocomplete="off">
      <label class="gate-label">Password
        <input type="password" id="teacherPassword" autocomplete="off" spellcheck="false">
      </label>
      <button type="submit" class="gate-go">Enter</button>
      <p class="gate-bad" id="teacherGateBad" hidden>That password is not right.</p>
    </form>
    <div class="sheet">${rows}</div>`;
}

function prepareUnitFlow(bookId, unit) {
  const targets = speakTargets(bookId, unit);
  const ids = targets.map((target) => target.id);
  const wordCount = sumWords(targets.map((target) => target.english));
  let flow = reconcileFlow(loadUnitFlow(bookId, unit.id), Date.now());
  if (flow.phase === 'part1' || flow.phase === 'teacher') {
    flow = advanceFlow(flow, ids, wordCount);
  }
  if (flow.phase === 'part2' && !flow.part2.wordCount) {
    flow = Object.assign({}, flow, {
      part2: Object.assign({}, flow.part2, { wordCount, limitSec: timerSeconds(wordCount) }),
    });
  }
  saveUnitFlow(bookId, unit.id, flow);
  return { targets, flow, wordCount };
}

function renderSheet(bookId, unitId) {
  const book = byId.get(bookId);
  const unit = book && book.units.find((u) => u.id === unitId);
  if (!unit) {
    document.body.classList.remove('phase-part2');
    appEl.innerHTML = '<p class="lead">That unit is not here.</p>';
    return;
  }
  const prepared = prepareUnitFlow(bookId, unit);
  const flow = prepared.flow;
  const targets = prepared.targets;
  const ready = !!checkerReady;
  document.body.classList.toggle('phase-part2', flow.phase === 'part2');
  const scores = flow.attempts || {};
  const wait = modelError
    ? `<p class="note">${escapeHtml(modelError)}</p>`
    : (ready ? '' : '<p class="note">The sound checker is still loading. Mic turns on when the bar finishes.</p>');
  const beside = questionCue(unit.title);
  const besideHtml = beside && beside !== unit.title ? `<span class="l1-beside">${escapeHtml(beside)}</span>` : '';
  const back = `<a class="back" href="#/book/${book.id}">← ${escapeHtml(book.label)}</a><h1>${escapeHtml(unit.title)}${besideHtml}</h1>${wait}`;
  if (flow.phase === 'teacher') {
    appEl.innerHTML = `${back}<div class="phase" data-phase="teacher">${teacherBlockHtml(targets, ready, flow)}</div>`;
    syncClock(null);
    return;
  }
  const view = sheetView(flow, targets);
  const shared = renderSharedQuestion(bookId, unit, scores, ready, view);
  const lines = sheetLines(bookId, unit);
  const rows = lines.map((line, index) => lineArticleHtml(line, unit, index, scores, ready, view)).join('');
  const rush = flow.phase === 'part2' || flow.phase === 'results' ? rushBarHtml(flow) : '';
  const results = flow.phase === 'results' ? resultsHtml(flow, targets) : '';
  appEl.innerHTML = `${back}${rush}${results}<div class="sheet phase" data-phase="${escapeHtml(flow.phase)}">${shared}${rows}</div>`;
  syncClock(flow.phase === 'part2' ? flow : null);
}

function syncClock(flow) {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  if (!flow || !timerRunning(flow)) return;
  clockTimer = setInterval(() => {
    const r = route();
    if (r.name !== 'sheet') return;
    const live = loadUnitFlow(r.bookId, r.unitId);
    if (!timerRunning(live)) {
      chain(() => endPart2(r.bookId, r.unitId));
      return;
    }
    const el = document.getElementById('rushClock');
    if (el) el.textContent = String(clockSeconds(live, Date.now()));
  }, 200);
}

function paint() {
  const x = window.scrollX || 0;
  const y = window.scrollY || 0;
  render();
  window.scrollTo(x, y);
}

function render() {
  if (!books.length) {
    document.body.classList.remove('phase-part2');
    appEl.innerHTML = '<p class="lead">Loading the sheets…</p>';
    return;
  }
  const r = route();
  if (r.name === 'units') {
    document.body.classList.remove('phase-part2');
    renderUnits(r.bookId);
  } else if (r.name === 'sheet') renderSheet(r.bookId, r.unitId);
  else {
    document.body.classList.remove('phase-part2');
    renderHome();
  }
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

function startSilenceWatch(stream, ctx, onDone, silenceMs, graceMs) {
  const endSilence = silenceMs == null ? SILENCE_MS : silenceMs;
  const grace = graceMs == null ? SILENCE_GRACE_MS : graceMs;
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
      } else if (totalMs > grace && spoke) {
        quietMs += SILENCE_CHECK_MS;
      }
      if (quietMs >= endSilence || totalMs >= MAX_RECORD_MS || (!spoke && totalMs >= 12000)) {
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

function claimCapture() {
  const rec = capture;
  capture = null;
  stopSilenceWatch();
  if (!rec) return null;
  try { rec.proc.disconnect(); rec.src.disconnect(); rec.gain.disconnect(); } catch (_) {}
  rec.stream.getTracks().forEach((t) => t.stop());
  return rec;
}

async function blobFrom(rec) {
  if (!rec) return null;
  const rate = rec.ctx.sampleRate || 48000;
  const blob = encodeWav(rec.chunks, rate);
  rec.ctx.close().catch(() => {});
  return blob;
}

async function stopCapture() {
  const rec = claimCapture();
  return blobFrom(rec);
}

function stillOnSheet(bookId, unitId) {
  const r = route();
  return r.name === 'sheet' && r.bookId === bookId && r.unitId === unitId;
}

function studentRecord(graded, gradeText, reason) {
  return {
    score: graded ? graded.score : 0,
    scorePct: graded ? graded.scorePct : 0,
    pass: graded ? !!graded.pass : false,
    weak: graded ? graded.weak : [],
    reason: graded ? graded.reason : reason,
    english: graded ? graded.english : scoringTarget(gradeText),
    words: graded ? graded.words : [],
    at: Date.now(),
  };
}

async function gradeRush(meta, blob) {
  rushInFlight += 1;
  try {
    const graded = await gradeBlob(blob, meta.gradeText);
    const flow = noteRushGrade(loadUnitFlow(meta.bookId, meta.unitId), meta.scoreKey, graded);
    saveUnitFlow(meta.bookId, meta.unitId, flow);
  } catch (err) {
    const flow = noteRushGrade(loadUnitFlow(meta.bookId, meta.unitId), meta.scoreKey, { pass: false, scorePct: 0 });
    saveUnitFlow(meta.bookId, meta.unitId, flow);
    console.error(err);
  } finally {
    rushInFlight -= 1;
    endRushCheck(meta.scoreKey);
    if (stillOnSheet(meta.bookId, meta.unitId)) paint();
  }
}

function stopIfLastRushLine(flow, ids, now) {
  const list = ids || [];
  if (!list.length || !list.every((id) => flow.rushRecorded[id])) return flow;
  return stopTimer(flow, now);
}

async function gradeStudentOrTeacher(meta, blob) {
  gradingScoreKey = meta.scoreKey;
  if (stillOnSheet(meta.bookId, meta.unitId)) paint();
  let graded = null;
  let thrown = null;
  try {
    graded = await gradeBlob(blob, meta.gradeText);
  } catch (err) {
    thrown = err;
    console.error(err);
  }
  if (meta.phase === 'teacher') {
    if (graded && graded.pass) {
      delete teacherMiss[meta.scoreKey];
      let flow = noteTeacherPass(loadUnitFlow(meta.bookId, meta.unitId), meta.scoreKey);
      flow = advanceFlow(flow, meta.ids, meta.wordCount);
      saveUnitFlow(meta.bookId, meta.unitId, flow);
    } else {
      teacherMiss[meta.scoreKey] = true;
    }
  } else {
    const failReason = thrown && thrown.code === 'too_short'
      ? 'Too short. Say the whole English line.'
      : 'Could not check that try. Say it again.';
    const record = thrown ? studentRecord(null, meta.gradeText, failReason) : studentRecord(graded, meta.gradeText);
    let flow = noteAttempt(loadUnitFlow(meta.bookId, meta.unitId), meta.scoreKey, record);
    flow = advanceFlow(flow, meta.ids, meta.wordCount);
    saveUnitFlow(meta.bookId, meta.unitId, flow);
    const scores = loadScores();
    scores[meta.scoreKey] = record;
    saveScores(scores);
    if (meta.itemId) {
      noteScoreToAuth(meta.itemId, record.scorePct);
      logToOneBook(meta.itemId, record);
    }
    if (stillOnSheet(meta.bookId, meta.unitId)) {
      void playExpectedOnFail(meta.gradeText, meta.audioRel, thrown ? false : !!(graded && graded.pass));
    }
  }
  if (!meta.gradeEpoch || meta.gradeEpoch === gradeEpoch) gradingScoreKey = null;
  if (stillOnSheet(meta.bookId, meta.unitId)) paint();
}

function yieldForTap() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function encodeWavOffTap(floatChunks, sampleRate) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./wav-worker.js?v=20261005-nextmic', import.meta.url));
    } catch (err) {
      reject(err);
      return;
    }
    const transfers = [];
    for (let i = 0; i < floatChunks.length; i++) {
      if (floatChunks[i] && floatChunks[i].buffer) transfers.push(floatChunks[i].buffer);
    }
    worker.onmessage = (ev) => {
      worker.terminate();
      resolve(new Blob([ev.data.buf], { type: 'audio/wav' }));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ chunks: floatChunks, sampleRate }, transfers);
  });
}

function commitPart2Take(meta) {
  beginRushCheck(meta.scoreKey);
  let flow = markRushRecorded(loadUnitFlow(meta.bookId, meta.unitId), meta.scoreKey);
  flow = stopIfLastRushLine(flow, meta.ids, Date.now());
  saveUnitFlow(meta.bookId, meta.unitId, flow);
}

function missPart2Take(meta) {
  endRushCheck(meta.scoreKey);
  const missed = noteRushGrade(loadUnitFlow(meta.bookId, meta.unitId), meta.scoreKey, { pass: false, scorePct: 0 });
  saveUnitFlow(meta.bookId, meta.unitId, missed);
  if (stillOnSheet(meta.bookId, meta.unitId)) paint();
}

async function gradePart2OffTap(meta) {
  await yieldForTap();
  let blob = null;
  try {
    blob = await encodeWavOffTap(meta.chunks, meta.ctx.sampleRate || 48000);
  } catch (err) {
    console.error(err);
  }
  meta.ctx.close().catch(() => {});
  if (blob) {
    void gradeRush(meta, blob);
    return;
  }
  missPart2Take(meta);
}

function queuePart2Grade(meta) {
  if (!meta || !meta.scoreKey || !meta.gradeText) return;
  commitPart2Take(meta);
  if (stillOnSheet(meta.bookId, meta.unitId)) paint();
  enqueueScore(() => gradePart2OffTap(meta));
}

async function gradeStudentOrTeacherOffTap(meta) {
  await yieldForTap();
  let blob = null;
  try {
    blob = await encodeWavOffTap(meta.chunks, meta.ctx.sampleRate || 48000);
  } catch (err) {
    console.error(err);
  }
  if (meta.ctx) meta.ctx.close().catch(() => {});
  await gradeStudentOrTeacher(meta, blob);
}

function queueTakeGrade(meta) {
  if (!meta || !meta.scoreKey || !meta.gradeText) {
    if (meta && meta.ctx) meta.ctx.close().catch(() => {});
    return;
  }
  if (meta.phase === 'part2') {
    queuePart2Grade(meta);
    return;
  }
  meta.gradeEpoch = ++gradeEpoch;
  gradingScoreKey = meta.scoreKey;
  if (stillOnSheet(meta.bookId, meta.unitId)) paint();
  enqueueScore(() => gradeStudentOrTeacherOffTap(meta));
}

function stopLiveTake() {
  const meta = claimCapture();
  if (!meta) return;
  queueTakeGrade(meta);
}

function finishTake() {
  stopLiveTake();
}

async function endPart2(bookId, unitId) {
  const cur = loadUnitFlow(bookId, unitId);
  if (cur.phase !== 'part2' || !cur.part2.startedAt || cur.part2.stoppedAt) return;
  const meta = claimCapture();
  let flow = loadUnitFlow(bookId, unitId);
  if (meta && meta.scoreKey) {
    beginRushCheck(meta.scoreKey);
    flow = markRushRecorded(flow, meta.scoreKey);
  }
  flow = stopTimer(flow, Date.now());
  saveUnitFlow(bookId, unitId, flow);
  if (stillOnSheet(bookId, unitId)) paint();
  if (meta && meta.scoreKey && meta.gradeText) enqueueScore(() => gradePart2OffTap(meta));
  else if (meta && meta.scoreKey) enqueueScore(() => { missPart2Take(meta); });
  else if (meta) meta.ctx.close().catch(() => {});
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
  const logitsMsg = await requestLogits(input);
  const logitsArr = logitsMsg.data;
  const T = logitsMsg.dims[1];
  const V = logitsMsg.dims[2];
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
  if (!authStudentId(auth.student())) return;
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
  const here = route();
  if (here.name === 'sheet' && loadUnitFlow(here.bookId, here.unitId).phase === 'part2') return;
  const url = hearSrc(audioRel);
  const plays = needsTripleHint(gradeText) ? 3 : 1;
  await playAudioUrl(url, plays);
}

let armingMic = false;
let armToken = 0;

async function onMic(btn) {
  const r = route();
  if (r.name !== 'sheet') return;
  const book = byId.get(r.bookId);
  const unit = book && book.units.find((u) => u.id === r.unitId);
  if (!unit) return;
  const flowNow = loadUnitFlow(r.bookId, r.unitId);
  const scoreKey = btn.getAttribute('data-score-key');
  const gradeText = btn.getAttribute('data-grade-text');
  const audioRel = btn.getAttribute('data-audio-rel');
  const itemId = btn.getAttribute('data-item-id');
  if (!scoreKey || !gradeText || !checkerReady) return;
  if (capture && capture.scoreKey === scoreKey) {
    stopLiveTake();
    return;
  }
  if (!canStartMic({
    phase: flowNow.phase,
    recording: false,
    timerRunning: timerRunning(flowNow),
    lineOpen: lineOpenFor(flowNow, scoreKey),
  })) return;
  if (capture && capture.scoreKey !== scoreKey) {
    const prev = claimCapture();
    queueTakeGrade(prev);
  }
  const token = ++armToken;
  armingMic = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    if (token === armToken) armingMic = false;
    modelLabel.classList.remove('done');
    modelLabel.textContent = 'The microphone is blocked. Allow the mic and tap again.';
    console.error(err);
    return;
  }
  const flow = loadUnitFlow(r.bookId, r.unitId);
  if (token !== armToken || capture || !canStartMic({
    phase: flow.phase,
    recording: false,
    timerRunning: timerRunning(flow),
    lineOpen: lineOpenFor(flow, scoreKey),
  })) {
    stream.getTracks().forEach((t) => t.stop());
    if (token === armToken) armingMic = false;
    return;
  }
  const targets = speakTargets(r.bookId, unit);
  capture = startCapture(stream);
  capture.scoreKey = scoreKey;
  capture.gradeText = gradeText;
  capture.audioRel = audioRel;
  capture.itemId = itemId || scoreKey;
  capture.phase = flow.phase;
  capture.bookId = r.bookId;
  capture.unitId = r.unitId;
  capture.ids = targets.map((target) => target.id);
  capture.wordCount = sumWords(targets.map((target) => target.english));
  armingMic = false;
  const part2 = flow.phase === 'part2';
  const rec = capture;
  startSilenceWatch(stream, rec.ctx, () => {
    chain(() => {
      if (capture !== rec) return;
      finishTake();
    });
  }, part2 ? PART2_SILENCE_MS : SILENCE_MS, part2 ? 0 : SILENCE_GRACE_MS);
  if (stillOnSheet(r.bookId, r.unitId)) paint();
}

function onRushStart() {
  const r = route();
  if (r.name !== 'sheet' || !checkerReady || capture || part1Busy) return;
  const flow = startTimer(loadUnitFlow(r.bookId, r.unitId), Date.now());
  saveUnitFlow(r.bookId, r.unitId, flow);
  render();
}

function onTeacherGate(ev) {
  ev.preventDefault();
  const r = route();
  if (r.name !== 'sheet') return;
  const book = byId.get(r.bookId);
  const unit = book && book.units.find((u) => u.id === r.unitId);
  if (!unit) return;
  const input = document.getElementById('teacherPassword');
  const text = input ? input.value : '';
  const targets = speakTargets(r.bookId, unit);
  const result = tryTeacherPassword(
    loadUnitFlow(r.bookId, r.unitId),
    targets.map((target) => target.id),
    sumWords(targets.map((target) => target.english)),
    text,
  );
  if (!result.ok) {
    const bad = document.getElementById('teacherGateBad');
    if (bad) bad.hidden = false;
    return;
  }
  saveUnitFlow(r.bookId, r.unitId, result.flow);
  render();
}

function onHear(btn) {
  const here = route();
  if (here.name === 'sheet' && loadUnitFlow(here.bookId, here.unitId).phase === 'part2') return;
  const rel = btn.getAttribute('data-audio');
  if (!rel) return;
  const audio = new Audio(hearSrc(rel));
  audio.play().catch((err) => console.error(err));
}

if (appEl) {
  appEl.addEventListener('click', (ev) => {
    const hear = ev.target.closest('.hear');
    if (hear) { onHear(hear); return; }
    if (ev.target.closest('#rushStart')) { onRushStart(); return; }
    if (ev.target.closest('#rushStop')) {
      const r = route();
      if (r.name === 'sheet') chain(() => endPart2(r.bookId, r.unitId));
      return;
    }
    if (ev.target.closest('.take-stop')) {
      stopLiveTake();
      return;
    }
    const mic = ev.target.closest('.mic');
    if (mic) onMic(mic);
  });

  appEl.addEventListener('submit', (ev) => {
    if (ev.target.closest('#teacherGate')) onTeacherGate(ev);
  });

  window.addEventListener('hashchange', () => {
    chain(async () => {
      const rec = claimCapture();
      if (rec) rec.ctx.close().catch(() => {});
      part1Busy = false;
      gradingScoreKey = null;
      render();
    });
  });

  fillLangMenu();
  applyLangDir();
  const langMenu = document.getElementById('langMenu');
  if (langMenu) {
    langMenu.addEventListener('change', () => {
      localStorage.setItem(LANG_KEY, langMenu.value);
      applyLangDir();
      render();
    });
  }

  window.addEventListener('mrj-auth-ready', onAuthReady);
  window.addEventListener('pagehide', () => {
    void flushPackSave(true);
  });

  loadContent().then(async () => {
    try {
      const response = await fetch('content/l1.json?v=20260930-l1');
      if (response.ok) l1Pack = await response.json();
    } catch (err) {
      console.error(err);
    }
    render();
  }).catch((err) => {
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
  speakTargets,
  speakWordCount,
};
