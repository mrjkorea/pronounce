import {
  PASS_PCT as ENGINE_PASS_PCT,
  APP_THRESHOLDS,
  MODEL_ID,
  bandForScore,
  getAppThresholds,
  tokenizeWords,
} from './engine.js?v=20261030-day4-mic-score';
import {
  RAW_MIC_CONSTRAINTS,
  decodeAudioToMono,
} from './audio.js?v=20261030-day4-mic-score';
import { sheetLines } from './sheet.js?v=20261030-day4-mic-score';
import {
  FLOW_STORAGE_KEY,
  LOCK_TEXT,
  advanceFlow,
  enterPart2,
  canStartMic as flowCanStartMic,
  isLocked,
  lineOpenFor as flowLineOpenFor,
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
  timerRunning as flowTimerRunning,
  timerSeconds,
} from './flow.js?v=20261030-day4-mic-score';
import { isMrjTeacher, installTeacherRefresh } from './mrj-teacher.js?v=20261030-day4-mic-score';

function lineOpenFor(flow, id) {
  if (isMrjTeacher()) return true;
  return flowLineOpenFor(flow, id);
}

function timerRunning(flow, now) {
  if (isMrjTeacher() && flow && flow.phase === 'part2') {
    const part = flow.part2 || {};
    return !!(part.startedAt && !part.stoppedAt);
  }
  return flowTimerRunning(flow, now);
}

function canStartMic(opts) {
  if (isMrjTeacher()) {
    if (opts && opts.lineOpen === false) return false;
    if (opts && opts.recording) return false;
    return true;
  }
  return flowCanStartMic(opts);
}
import {
  DOOR_CHECKING_TEXT,
  DOOR_FAIL_TEXT,
  gradeTrialSamples,
  MODEL_DOWNLOAD_STALL_MS,
  trialRuntime,
} from './trial.js?v=20261030-day4-mic-score';
import { bootShared, resetSharedBoot } from './shared.js?v=20261030-day4-mic-score';

import {
  PROGRAM,
  REMOTE_SAVE_MIN_MS,
  authStudentId,
  buildPackSavePayload,
  loadPackWithRetry,
  mergeScoresAfterServerFetch,
  packLoadAllowsSave,
  parsePackJson,
  mergeScoreMaps,
  scoresNeedSaveAfterSync,
  shouldFlushPackOnPagehide,
  studentScoreStorageKey,
} from './progress-merge.js?v=20261030-day4-mic-score';
import { createPackSaveScheduler } from './pack-save-scheduler.js?v=20261030-day4-mic-score';
import { reportScoredActivity } from './score-reporting.js?v=20261030-day4-mic-score';

export const PASS_PCT = ENGINE_PASS_PCT; // pass = line average >= 60
let activeStudentKey = '';
const remoteSync = {
  packLoadOk: false,
  loadedServerScores: {},
  syncGen: 0,
  packSave: null,
};

function packSaveScheduler() {
  if (!remoteSync.packSave) {
    remoteSync.packSave = createPackSaveScheduler({
      minIntervalMs: REMOTE_SAVE_MIN_MS,
      getPackLoadOk: () => remoteSync.packLoadOk,
      setPackLoadOk: (ok) => { remoteSync.packLoadOk = !!ok; },
      isAuthReady: () => {
        const auth = window.MRJ_AUTH;
        return !!(auth && typeof auth.savePack === 'function'
          && auth.packReady && auth.packReady(PROGRAM));
      },
      readLocalScores: () => loadScores(),
      getLoadedServerScores: () => remoteSync.loadedServerScores,
      setLoadedServerScores: (scores) => { remoteSync.loadedServerScores = scores || {}; },
      savePack: (json) => window.MRJ_AUTH.savePack(PROGRAM, json),
      ensurePackLoaded: () => ensurePackLoadedForSave(),
      buildPackSavePayload,
      scoresNeedSaveAfterSync,
      shouldFlushOnPagehide: shouldFlushPackOnPagehide,
    });
  }
  return remoteSync.packSave;
}

async function ensurePackLoadedForSave() {
  const auth = window.MRJ_AUTH;
  if (!auth || typeof auth.loadPack !== 'function') return false;
  const loaded = await loadPackWithRetry((program) => auth.loadPack(program), PROGRAM);
  if (!loaded.ok || !packLoadAllowsSave(loaded.result)) return false;
  remoteSync.packLoadOk = true;
  const parsed = parsePackJson(loaded.result.progress_json);
  remoteSync.loadedServerScores = mergeScoreMaps(
    remoteSync.loadedServerScores,
    parsed.scores,
  );
  return !!(auth.packReady && auth.packReady(PROGRAM));
}
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

// Auto-stop ~500 ms after speech ends
export const SILENCE_MS = 500;
export const SILENCE_GRACE_MS = 900;
export const PART2_SILENCE_MS = 400;
const SILENCE_CHECK_MS = 50;
const SILENCE_RMS = 0.018;
const MAX_RECORD_MS = 60000;

const appEl = typeof document !== 'undefined' ? document.getElementById('app') : null;
const modelLabel = typeof document !== 'undefined' ? document.getElementById('modelLabel') : null;
const modelFill = typeof document !== 'undefined' ? document.getElementById('modelFill') : null;
const modelTrack = typeof document !== 'undefined' ? document.getElementById('modelTrack') : null;

let books = [];
let byId = new Map();
let checkerReady = false;
let modelError = '';
let capture = null;
let silenceTimer = null;
let silenceNodes = null;
let gradingScoreKey = null;
let gradeEpoch = 0;
let pronounceChecking = false;
let part1Busy = false;
let playingMandatoryAudio = false;
let mandatoryAudioScoreKey = null;
let mandatoryAudioEl = null;
let rushInFlight = 0;
const rushChecking = new Map();
let chainTail = Promise.resolve();
let scoreTail = Promise.resolve();
let clockTimer = null;
let teacherMiss = {};

export function currentAppId() {
  try {
    if (typeof window !== 'undefined') {
      if (window.MRJ_APP_TYPE) return String(window.MRJ_APP_TYPE).toLowerCase();
      const q = new URLSearchParams(window.location?.search || '').get('app');
      if (q) return q.toLowerCase();
    }
  } catch (_) {}
  return 'day4';
}

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

/**
 * Single words are spoken ONCE (no 3x repeat hack).
 */
function scoringTarget(english) {
  return String(english || '').trim();
}

function needsTripleHint(_english) {
  return false;
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
  packSaveScheduler().markDirty();
}

function schedulePackSave(delayMs) {
  packSaveScheduler().schedule(delayMs);
}

function flushPackSave(force, opts) {
  return packSaveScheduler().flush(force, opts);
}

async function syncScoresFromServer(detail) {
  const auth = window.MRJ_AUTH;
  if (!auth) return;
  const studentId = authStudentId(typeof auth.student === 'function' ? auth.student() : '');
  const nextKey = studentScoreStorageKey(studentId);
  if (!studentId) {
    activeStudentKey = '';
    remoteSync.packLoadOk = false;
    packSaveScheduler().setDirty(false);
    remoteSync.loadedServerScores = {};
    return;
  }
  const syncGen = ++remoteSync.syncGen;
  activeStudentKey = nextKey;
  remoteSync.packLoadOk = false;
  remoteSync.loadedServerScores = {};
  const sched = packSaveScheduler();
  sched.prepareForServerSync();
  sched.setDirty(false);

  let packJson = '';
  if (typeof auth.loadPack === 'function') {
    const loaded = await loadPackWithRetry((program) => auth.loadPack(program), PROGRAM);
    if (syncGen !== remoteSync.syncGen || activeStudentKey !== nextKey) return;
    if (loaded.ok && packLoadAllowsSave(loaded.result)) {
      remoteSync.packLoadOk = true;
      packJson = loaded.result.progress_json;
    }
  }

  let progressRows = [];
  if (typeof auth.loadProgressForApp === 'function') {
    const prog = await auth.loadProgressForApp(PROGRAM);
    if (syncGen !== remoteSync.syncGen || activeStudentKey !== nextKey) return;
    if (prog && prog.ok && Array.isArray(prog.progress)) progressRows = prog.progress;
  } else if (detail && Array.isArray(detail.progress)) {
    progressRows = detail.progress;
  }

  const { merged, serverMerged } = mergeScoresAfterServerFetch(
    () => loadScores(),
    remoteSync.packLoadOk ? packJson : '{}',
    progressRows,
  );

  if (syncGen !== remoteSync.syncGen || activeStudentKey !== nextKey) return;

  if (activeStudentKey) {
    localStorage.setItem(activeStudentKey, JSON.stringify(merged));
    remoteSync.loadedServerScores = serverMerged;
    const sched = packSaveScheduler();
    const dirtyBefore = sched.getDirty();
    sched.setDirty(dirtyBefore || scoresNeedSaveAfterSync(merged, serverMerged));
    if (remoteSync.packLoadOk && sched.getDirty()) {
      sched.setLastSaveAt(0);
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
  syncStudentChrome();
  exposeBenchHook();
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
  if (!modelFill || !modelLabel) return;
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  modelFill.style.width = pct + '%';
  modelLabel.textContent = text;
}

function markModelReady() {
  if (modelLabel) modelLabel.classList.add('done');
  if (modelTrack) modelTrack.classList.add('done');
  exposeBenchHook();
}

function benchModeEnabled() {
  try {
    if (new URLSearchParams(location.search).get('bench') === '1') return true;
    const auth = window.MRJ_AUTH;
    const id = authStudentId(typeof auth?.student === 'function' ? auth.student() : auth);
    return String(id).toLowerCase().startsWith('zz_test');
  } catch (_) {
    return false;
  }
}

function exposeBenchHook() {
  if (!checkerReady) return;
  if (!benchModeEnabled()) return;
  const appId = currentAppId();
  const thresholds = getAppThresholds(appId);
  window.__mrjPronounceBench = async (blob, english, gradeOpts = {}) => {
    const passAt = typeof gradeOpts?.passAt === 'number' ? gradeOpts.passAt : PASS_PCT;
    const target = scoringTarget(english);
    const samples = await decodeAudioToMono(blob, 16000);
    const graded = await gradeTrialSamples(samples, target, passAt, null, {
      ...gradeOpts,
      appId: gradeOpts?.appId || appId,
    });
    return { result: graded.result, door: graded.door, perf: graded.perf };
  };
  window.__mrjTrialBoot = () => {
    const rt = trialRuntime();
    return {
      grader: 'hubert-phoneme',
      modelId: MODEL_ID,
      ready: checkerReady,
      fromCache: !!rt.fromCache,
      cacheSource: rt.cacheSource || 'none',
      cachedBytes: rt.cachedBytes || 0,
    };
  };
}

async function retryModelFromLabel() {
  if (!modelLabel || modelLabel.dataset.retry !== '1') return;
  delete modelLabel.dataset.retry;
  modelError = '';
  resetSharedBoot();
  await bootModel();
}

/** Day 4: block until HuBERT is ready before enabling Mic (no fail-open paint). Embeds use bootSharedForUi in shared.js. */
async function bootModel() {
  try {
    checkerReady = false;
    setProgress(0.02, 'Loading the sound checker…');
    render();
    const wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
    await bootShared({
      wasmPaths,
      onProgress: (frac, label) => setProgress(frac, label),
      downloadStallMs: MODEL_DOWNLOAD_STALL_MS,
    });
    checkerReady = true;
    modelError = null;
    if (modelLabel) delete modelLabel.dataset.retry;
    setProgress(1, 'Ready');
    markModelReady();
    render();
  } catch (err) {
    checkerReady = false;
    modelError = err && err.message ? err.message : String(err);
    if (modelLabel) {
      modelLabel.classList.remove('done');
      modelLabel.textContent = `Listen-only · ${modelError} Tap to retry.`;
      modelLabel.dataset.retry = '1';
    } else {
      modelError = 'Sound checker did not start. ' + modelError;
    }
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

function studentDisplayId() {
  try {
    const auth = window.MRJ_AUTH || window.MRJSignin;
    if (auth && typeof auth.student === 'function') return String(auth.student() || '').trim();
  } catch (_) { /* ignore */ }
  return '';
}

function syncStudentChrome() {
  const id = studentDisplayId();
  const pill = document.getElementById('pronounceStudentPill');
  if (pill) {
    if (id) {
      pill.textContent = id;
      pill.hidden = false;
    } else {
      pill.hidden = true;
      pill.textContent = '';
    }
  }
  try {
    const auth = window.MRJ_AUTH || window.MRJSignin;
    if (auth && typeof auth.applyStudentChrome === 'function') auth.applyStudentChrome();
    else if (auth && typeof auth.updateStudentChip === 'function') auth.updateStudentChip();
  } catch (_) { /* ignore */ }
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
    return `<a class="book" href="#/book/${book.id}">${book.label}<small>${prog.pass} / ${prog.n} (${prog.n ? Math.round((prog.pass / prog.n) * 100) : 0}%) passed</small></a>`;
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
    return `<a class="unit" href="#/book/${book.id}/unit/${unit.id}">${unit.title}<small>${passed} / ${lines.length} (${lines.length ? Math.round((passed / lines.length) * 100) : 0}%)</small></a>`;
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

/** Word and line colours use the same 0–100 number the student sees. A 0–1 value is scaled up. */
function shownPct(value, fallback) {
  const primary = Number(value);
  if (Number.isFinite(primary)) {
    if (primary > 0 && primary < 1) return Math.round(primary * 100);
    return Math.round(primary);
  }
  const raw = Number(fallback) || 0;
  if (raw > 0 && raw < 1) return Math.round(raw * 100);
  return Math.round(raw);
}

function wordChipsHtml(words, _record) {
  if (!words || !words.length) return '';
  const appId = currentAppId();
  const chips = words.map((w) => {
    const pct = shownPct(w.scorePct, w.score);
    const band = bandForScore(pct, appId);
    const cls = band === 'green' ? 'good green' : (band === 'yellow' ? 'yellow' : 'bad red');
    const hintHtml = w.hint && band !== 'green'
      ? `<span class="word-hint">${escapeHtml(w.hint)}</span>`
      : '';
    return `<span class="word-chip-wrap"><span class="word-chip ${cls}" data-band="${escapeHtml(band)}" title="${pct}%">${escapeHtml(w.word)}</span>${hintHtml}</span>`;
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
  return `<p class="${className}">${escapeHtml(english)}</p>`;
}

export function partResultHtml(saved) {
  if (!saved) return '';
  if (saved.doorFail) {
    return `<div class="after show"><p class="meta">${escapeHtml(saved.reason || DOOR_FAIL_TEXT)}</p></div>`;
  }
  const appId = currentAppId();
  const pct = shownPct(saved.scorePct, saved.score);
  const band = bandForScore(pct, appId);
  let verdict = 'Not yet';
  let cls = 'fail red';
  if (saved.pass && band !== 'yellow') {
    verdict = 'Pass';
    cls = 'pass green';
  } else if (band === 'yellow') {
    verdict = saved.pass ? 'Almost (Move on)' : 'Not yet';
    cls = saved.pass ? 'pass yellow' : 'fail yellow';
  }
  const reason = !saved.pass && saved.reason
    ? `<p class="meta">${escapeHtml(saved.reason)}</p>`
    : '';
  const chips = englishRevealed(saved) ? wordChipsHtml(saved.words, saved) : '';
  return `<div class="after show" data-band="${escapeHtml(band)}">
    <p class="verdict ${cls}">${verdict} · ${pct}</p>
    ${chips}
    ${reason}
  </div>`;
}

function micButtonHtml(skey, itemId, partKey, english, audioRel, allowed, ready, label) {
  const live = !!(capture && capture.scoreKey === skey);
  let text = 'Wait';
  if (live) text = 'Listening…';
  else if (label && label !== 'Mic') text = label;
  else if (ready) text = 'Mic';

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
  if (grade.doorFail) return 'door';
  return grade.pass ? 'pass' : 'fail';
}

function checkHtml(mark) {
  if (mark === 'door') return '';
  if (mark === 'pass') return '<span class="got-it" aria-label="Pass">✓</span>';
  if (mark === 'fail') return '<span class="not-yet" aria-label="Not yet"><span class="rush-x" aria-hidden="true">✗</span> Not yet</span>';
  if (mark === 'checking') return '<span class="rush-checking">Checking</span>';
  return '';
}

function rushFeedbackHtml(shown) {
  if (!shown) return '';
  if (shown.doorFail) return `<p class="meta">${escapeHtml(shown.reason || DOOR_FAIL_TEXT)}</p>`;
  return wordChipsHtml(shown.words, shown);
}

function checkingLineHtml(active) {
  if (!active || !pronounceChecking) return '';
  return `<p class="checking-line">${DOOR_CHECKING_TEXT}</p>`;
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
  const rushMarks = view.rush && revealed ? rushFeedbackHtml(shown) : '';
  const meaning = questionCue(plan.question);
  const meaningHtml = meaning ? `<p class="l1-prompt">${escapeHtml(meaning)}</p>` : '';
  const result = view.hideVerdict ? '' : partResultHtml(saved);
  const gradingShared = gradingScoreKey === sk && !view.hideVerdict;
  const gradeBar = gradingShared ? `${checkingLineHtml(true)}<div class="grade-bar shared-grade show"><div class="grade-fill"></div></div>` : '';
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

// Voice choice: Coach Ray (default, audio/) or Miss Harper (audio_harper/).
// Remembered in the URL (?voice=harper) and sessionStorage only. Clips load on tap.
const VOICE_SESSION_KEY = 'mrj_pronounce_voice';
let voice = (() => {
  try {
    const q = new URLSearchParams(location.search).get('voice');
    if (q === 'harper' || q === 'ray') return q;
    const s = sessionStorage.getItem(VOICE_SESSION_KEY);
    if (s === 'harper' || s === 'ray') return s;
  } catch (_) { /* ignore */ }
  return 'ray';
})();

function setVoice(v) {
  if (v !== 'ray' && v !== 'harper') return;
  voice = v;
  try { sessionStorage.setItem(VOICE_SESSION_KEY, v); } catch (_) { /* ignore */ }
  try {
    const u = new URL(location.href);
    if (v === 'harper') u.searchParams.set('voice', 'harper'); else u.searchParams.delete('voice');
    history.replaceState(history.state, '', u.toString());
  } catch (_) { /* ignore */ }
  document.querySelectorAll('.voice-btn').forEach((b) => {
    const on = b.dataset.voice === v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// Only top-level line clips (audio/<id>.mp3) have a Harper twin; hear/ clips stay Coach Ray.
function harperRel(rel) {
  const m = /^audio\/([^/]+\.mp3)$/.exec(rel || '');
  return m ? `audio_harper/${m[1]}` : '';
}

function hearSrc(rel) {
  if (voice === 'harper') {
    const h = harperRel(rel);
    if (h) return h;
  }
  return rel || '';
}

if (typeof document !== 'undefined') {
  document.querySelectorAll('.voice-btn').forEach((b) => {
    b.addEventListener('click', () => setVoice(b.dataset.voice));
  });
  setVoice(voice);
}

function koHtml(korean, imageRel, local, extraHtml) {
  const src = imageRel || '';
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
    const rushMarks = view.rush && revealed ? rushFeedbackHtml(shown) : '';
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
  const gradeBar = grading ? `${checkingLineHtml(true)}<div class="grade-bar show"><div class="grade-fill"></div></div>` : '';
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
      playingMandatoryAudio,
    });
    if (flow.phase === 'part1' && isLocked(flow, id) && !isMrjTeacher()) locked[id] = true;
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
  const limit = flow.part2.limitSec || timerSeconds(0);
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
    ${view.total ? `<p class="big-pct" style="font-size:2.4rem;font-weight:900;margin:.2em 0">Part 1: ${Math.round((view.passed / view.total) * 100)}% · Part 2: ${Math.round((view.rushPassed / view.total) * 100)}%</p>` : ''}
    <p>Seconds used: ${view.secondsUsed}. Limit ${view.limitSec}.</p>
    <p>Part 2 pronunciation: ${view.rushPassed} passed${view.total ? ` (${Math.round((view.rushPassed / view.total) * 100)}%)` : ''}</p>
    <p>Part 1 pronunciation: ${view.passed} passed${view.total ? ` (${Math.round((view.passed / view.total) * 100)}%)` : ''}</p>
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
  return flow.part2.limitSec || timerSeconds(0);
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
      playingMandatoryAudio,
    });
    const mic = micButtonHtml(target.id, target.itemId, target.partKey, target.english, target.audio, allowed, ready, 'Teacher mic');
    return `<article class="row teacher-row" data-id="${escapeHtml(target.id)}">
      ${koHtml(teacherKorean(target), target.image, target.local, teacherMeaning(target))}
      <div class="mic-cell">${mic}</div>
      ${miss}
    </article>`;
  }).join('');
  const gateHint = isMrjTeacher()
    ? ''
    : '<p class="teacher-gate-hint ask-teacher">To open Part 2, tap <strong>Teacher</strong> in the top bar and enter the classroom PIN.</p>';
  return `${gateHint}<div class="sheet">${rows}</div>`;
}

function prepareUnitFlow(bookId, unit) {
  const targets = speakTargets(bookId, unit);
  const ids = targets.map((target) => target.id);
  const wordCount = sumWords(targets.map((target) => target.english));
  let flow = loadUnitFlow(bookId, unit.id);
  if (isMrjTeacher()) {
    if (flow.phase === 'part1' || flow.phase === 'teacher') flow = enterPart2(flow, wordCount);
  } else {
    flow = reconcileFlow(flow, Date.now());
    if (flow.phase === 'part1' || flow.phase === 'teacher') {
      flow = advanceFlow(flow, ids, wordCount);
    }
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
  if (!appEl) return;
  const x = window.scrollX || 0;
  const y = window.scrollY || 0;
  render();
  window.scrollTo(x, y);
}

function render() {
  if (!appEl) return;
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
    analyser.smoothingTimeConstant = 0.25;
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
      } else if (totalMs >= grace && spoke) {
        quietMs += SILENCE_CHECK_MS;
      }
      if (quietMs >= endSilence || totalMs >= MAX_RECORD_MS || (!spoke && totalMs >= 8000)) {
        finish();
        return;
      }
      silenceTimer = setTimeout(tick, SILENCE_CHECK_MS);
    };
    silenceTimer = setTimeout(tick, SILENCE_CHECK_MS);
  } catch (e) {
    console.warn('startSilenceWatch failed', e);
    silenceTimer = setTimeout(finish, 4000);
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

function stillOnSheet(bookId, unitId) {
  const r = route();
  return r.name === 'sheet' && r.bookId === bookId && r.unitId === unitId;
}

function studentRecord(graded, gradeText, reason) {
  const appId = currentAppId();
  const pct = graded ? graded.scorePct : 0;
  const pass = graded ? !!graded.pass : false;
  const band = graded && graded.band ? graded.band : bandForScore(pct, appId);
  return {
    score: graded ? graded.score : 0,
    scorePct: pct,
    band,
    color: band,
    pass,
    assistedPass: !!(graded && (graded.assistedPass || (pass && band === 'yellow'))),
    weak: graded ? graded.weak : [],
    missedWords: graded ? (graded.missedWords || graded.weak || []) : [],
    yellowWords: graded ? (graded.yellowWords || []) : [],
    reason: graded ? graded.reason : reason,
    english: graded ? graded.english : scoringTarget(gradeText),
    words: graded && !graded.doorFail ? graded.words : [],
    doorFail: graded ? !!graded.doorFail : false,
    grader: graded && graded.grader ? graded.grader : 'hubert-phoneme',
    at: Date.now(),
  };
}

function doorPassHook(meta) {
  return {
    onDoorPass: () => {
      pronounceChecking = true;
      if (stillOnSheet(meta.bookId, meta.unitId)) paint();
    },
  };
}

async function gradeRush(meta, blob) {
  rushInFlight += 1;
  try {
    const graded = await gradeBlob(blob, meta.gradeText, doorPassHook(meta), { hints: false });
    const flow = noteRushGrade(loadUnitFlow(meta.bookId, meta.unitId), meta.scoreKey, graded);
    saveUnitFlow(meta.bookId, meta.unitId, flow);
  } catch (err) {
    const flow = noteRushGrade(loadUnitFlow(meta.bookId, meta.unitId), meta.scoreKey, { pass: false, scorePct: 0 });
    saveUnitFlow(meta.bookId, meta.unitId, flow);
    console.error(err);
  } finally {
    pronounceChecking = false;
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

/**
 * Determine whether the pre-recorded voice file must be played after an attempt.
 * Requirement 7: "On any red or yellow word, automatically play the existing pre-recorded
 * voice file for that word or line before the next try is allowed (the child cannot skip it)."
 */
export function shouldPlayMandatoryAudio(record, thrown) {
  if (thrown || !record) return true;
  if (!record.pass || record.band === 'red' || record.band === 'yellow') return true;
  if (Array.isArray(record.yellowWords) && record.yellowWords.length > 0) return true;
  if (Array.isArray(record.missedWords) && record.missedWords.length > 0) return true;
  if (Array.isArray(record.words) && record.words.some((w) => w.band === 'red' || w.band === 'yellow')) {
    return true;
  }
  return false;
}

async function gradeStudentOrTeacher(meta, blob) {
  gradingScoreKey = meta.scoreKey;
  if (stillOnSheet(meta.bookId, meta.unitId)) paint();
  let graded = null;
  let thrown = null;

  try {
    graded = await gradeBlob(blob, meta.gradeText, doorPassHook(meta), {
      hints: meta.phase !== 'part2',
    });
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
      reportScoredActivity({
        itemId: meta.itemId,
        record,
        thrown,
        meta,
        auth: window.MRJ_AUTH,
        mrjScores: window.MRJ_SCORES,
        localDateFn: () => (window.MRJ_SCORES && window.MRJ_SCORES.localDate
          ? window.MRJ_SCORES.localDate()
          : ''),
      });
    }
    pronounceChecking = false;
    if (!meta.gradeEpoch || meta.gradeEpoch === gradeEpoch) gradingScoreKey = null;
    if (stillOnSheet(meta.bookId, meta.unitId)) paint();

    if (stillOnSheet(meta.bookId, meta.unitId) && shouldPlayMandatoryAudio(record, thrown)) {
      await playMandatoryExpectedAudio(meta.scoreKey, meta.audioRel);
    }
    return;
  }
  pronounceChecking = false;
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
      worker = new Worker(new URL('./wav-worker.js?v=20261030-day4-mic-score', import.meta.url));
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
    blob = encodeWav(meta.chunks, meta.ctx ? meta.ctx.sampleRate || 48000 : 48000);
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

async function gradeBlob(blob, english, hooks, gradeOpts = {}) {
  const appId = currentAppId();
  const thresholds = getAppThresholds(appId);
  const target = scoringTarget(english);
  const samples = await decodeAudioToMono(blob, 16000);
  const graded = await gradeTrialSamples(samples, target, PASS_PCT, hooks, {
    ...gradeOpts,
    appId,
  });
  return graded.result;
}

function stopMandatoryPlayback() {
  playingMandatoryAudio = false;
  mandatoryAudioScoreKey = null;
  const audio = mandatoryAudioEl;
  mandatoryAudioEl = null;
  if (!audio) return;
  try { audio.pause(); } catch (_) {}
  try { audio.dispatchEvent(new Event('ended')); } catch (_) {}
}

function playAudioUrl(url) {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined' || !url) {
      resolve();
      return;
    }
    let settled = false;
    const audio = new Audio(url);
    mandatoryAudioEl = audio;
    const done = () => {
      if (settled) return;
      settled = true;
      if (mandatoryAudioEl === audio) mandatoryAudioEl = null;
      resolve();
    };
    const timer = setTimeout(done, 8000);
    audio.addEventListener('ended', () => { clearTimeout(timer); done(); });
    audio.addEventListener('error', () => { clearTimeout(timer); done(); });
    audio.play().catch(() => { clearTimeout(timer); done(); });
  });
}

/**
 * Play pre-recorded voice file on any red or yellow word while locking the mic
 * so the child cannot skip listening before their next try.
 */
async function playMandatoryExpectedAudio(scoreKey, audioRel) {
  if (!audioRel) return;
  const here = route();
  if (here.name === 'sheet' && loadUnitFlow(here.bookId, here.unitId).phase === 'part2') return;
  playingMandatoryAudio = true;
  mandatoryAudioScoreKey = scoreKey;
  if (here.name === 'sheet') paint();
  try {
    await playAudioUrl(hearSrc(audioRel));
  } finally {
    playingMandatoryAudio = false;
    mandatoryAudioScoreKey = null;
    if (route().name === 'sheet') paint();
  }
}

let armingMic = false;
let armToken = 0;

async function onMic(btn) {
  stopMandatoryPlayback();
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
    playingMandatoryAudio,
  })) return;
  if (capture && capture.scoreKey !== scoreKey) {
    const prev = claimCapture();
    queueTakeGrade(prev);
  }
  const token = ++armToken;
  armingMic = true;
  let stream;
  try {
    // Requirement 4: Turn off browser noiseSuppression, echoCancellation, autoGainControl
    stream = await navigator.mediaDevices.getUserMedia({
      audio: RAW_MIC_CONSTRAINTS,
    });
  } catch (err) {
    if (token === armToken) armingMic = false;
    if (modelLabel) {
      modelLabel.classList.remove('done');
      modelLabel.textContent = 'The microphone is blocked. Allow the mic and tap again.';
    }
    console.error(err);
    return;
  }
  const flow = loadUnitFlow(r.bookId, r.unitId);
  if (token !== armToken || capture || !canStartMic({
    phase: flow.phase,
    recording: false,
    timerRunning: timerRunning(flow),
    lineOpen: lineOpenFor(flow, scoreKey),
    playingMandatoryAudio,
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

function onHear(btn) {
  const here = route();
  if (here.name === 'sheet' && loadUnitFlow(here.bookId, here.unitId).phase === 'part2') return;
  const rel = btn.getAttribute('data-audio');
  if (!rel) return;
  const src = hearSrc(rel);
  const audio = new Audio(src);
  if (src !== rel) audio.addEventListener('error', () => { new Audio(rel).play().catch(() => {}); }, { once: true });
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
  modelLabel?.addEventListener('click', () => {
    void retryModelFromLabel();
  });
  const langMenu = document.getElementById('langMenu');
  if (langMenu) {
    langMenu.addEventListener('change', () => {
      localStorage.setItem(LANG_KEY, langMenu.value);
      applyLangDir();
      render();
    });
  }

  syncStudentChrome();
  installTeacherRefresh(() => {
    syncStudentChrome();
    render();
  });

  window.addEventListener('mrj-auth-ready', onAuthReady);
  document.addEventListener('mrj-teacher', () => {
    syncStudentChrome();
    render();
  });
  const flushPackOnHide = () => {
    void flushPackSave(true, { pagehide: true });
  };
  window.addEventListener('pagehide', flushPackOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPackOnHide();
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
  APP_THRESHOLDS,
  QUESTION_CODES,
  RAW_MIC_CONSTRAINTS,
  analyzeUnit,
  scoringTarget,
  needsTripleHint,
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
