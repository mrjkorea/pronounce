import {
  bootSharedForUi,
  grade,
  tokenizeWords,
  getModelBootState,
} from '../../src/shared.js';
import {
  applyI18n,
  fillLangSelect,
  getUiLang,
  setUiLang,
  t,
} from './i18n.js';
import { recordOnce } from './mic.js';
import {
  downloadText,
  exportHistoryCsv,
  exportHistoryJson,
  loadGuides,
  loadHistory,
  MAX_GUIDES,
  MAX_SENTENCES_PER_GUIDE,
  pushHistory,
  saveGuides,
} from './storage.js';
import { getTtsMode, initTts, setVoice, speak, ttsNoteText } from './tts.js';

const $ = (sel) => document.querySelector(sel);
const bootOverlay = $('#bootOverlay');
const bootStatus = $('#bootStatus');
const bootFill = $('#bootFill');
const uiLang = $('#uiLang');
const practiceText = $('#practiceText');
const btnListen = $('#btnListen');
const btnRecord = $('#btnRecord');
const wordChips = $('#wordChips');
const lineResult = $('#lineResult');
const ttsNote = $('#ttsNote');
const bookList = $('#bookList');
const bookDetail = $('#bookDetail');
const guidesList = $('#guidesList');
const guideEditor = $('#guideEditor');
const historyList = $('#historyList');
const historySearch = $('#historySearch');
const historyStats = $('#historyStats');
const modelStatus = $('#modelStatus');
const btnRetryChecker = $('#btnRetryChecker');

let ui = getUiLang();
let booksData = null;
let recording = false;
let engineReady = false;
let uiBoot = null;

function setModelStatus(msg, showRetry = false) {
  if (modelStatus) {
    modelStatus.textContent = msg || '';
    modelStatus.hidden = !msg;
  }
  if (btnRetryChecker) btnRetryChecker.hidden = !showRetry;
}

function paintPracticeHint() {
  const hint = $('#practiceHint');
  if (!hint) return;
  hint.textContent = engineReady ? t('practiceHint', ui) : t('basicListen', ui);
}

async function finishCheckerLoad() {
  if (!uiBoot) return;
  try {
    await uiBoot.ensureModel();
    engineReady = true;
    btnRecord.disabled = false;
    setModelStatus(t('checkerReady', ui));
    paintPracticeHint();
  } catch (err) {
    console.error(err);
    engineReady = false;
    btnRecord.disabled = true;
    setModelStatus(t('checkerFailed', ui), true);
    paintPracticeHint();
  }
}

async function retryChecker() {
  if (!uiBoot?.retryModel) return;
  setModelStatus(t('grading', ui));
  btnRetryChecker.hidden = true;
  try {
    await uiBoot.retryModel();
    engineReady = true;
    btnRecord.disabled = false;
    setModelStatus(t('checkerReady', ui));
    paintPracticeHint();
  } catch (err) {
    console.error(err);
    setModelStatus(t('checkerFailed', ui), true);
  }
}

function setBootProgress(pct, msg) {
  if (bootStatus && msg) bootStatus.textContent = msg;
  if (bootFill) bootFill.style.width = `${Math.round(Math.min(1, pct) * 100)}%`;
}

function hideBoot() {
  bootOverlay?.classList.add('is-done');
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach((p) => {
    const id = p.id.replace('panel', '').toLowerCase();
    const on = id === name;
    p.classList.toggle('is-active', on);
    p.hidden = !on;
  });
}

function currentLine() {
  return String(practiceText?.value || '').trim().replace(/\s+/g, ' ');
}

function paintPendingChips(text) {
  if (!wordChips) return;
  const words = tokenizeWords(text);
  wordChips.innerHTML = '';
  words.forEach((w) => {
    const span = document.createElement('button');
    span.type = 'button';
    span.className = 'chip pending';
    span.textContent = w;
    span.title = t('listen', ui);
    span.addEventListener('click', () => {
      void speak(w);
    });
    wordChips.appendChild(span);
  });
}

function paintGradedChips(graded) {
  if (!wordChips) return;
  wordChips.innerHTML = '';
  const words = graded?.words?.length
    ? graded.words
    : tokenizeWords(graded?.english || currentLine()).map((w) => ({ word: w, band: 'red', scorePct: 0 }));
  words.forEach((w) => {
    const span = document.createElement('button');
    span.type = 'button';
    span.className = `chip ${w.band || w.color || 'red'}`;
    span.textContent = `${w.word} · ${w.scorePct ?? 0}`;
    span.addEventListener('click', () => {
      void speak(w.word);
    });
    wordChips.appendChild(span);
  });
}

function showLineResult(graded) {
  if (!lineResult) return;
  const pct = graded?.scorePct ?? graded?.overall?.scorePct ?? 0;
  const pass = graded?.pass ?? (pct >= 60 && !graded?.doorFail);
  lineResult.hidden = false;
  lineResult.className = `line-result ${pass ? 'pass' : 'fail'}`;
  lineResult.textContent = pass ? t('passLine', ui, { pct }) : t('failLine', ui, { pct });
}

async function runGrade(blob, source) {
  const text = currentLine();
  if (!text) {
    alert(t('emptyText', ui));
    return;
  }
  if (!engineReady) {
    alert(t('gradingWait', ui));
    return;
  }
  btnRecord.disabled = true;
  btnRecord.textContent = t('grading', ui);
  paintPendingChips(text);
  try {
    const pack = await grade(blob, text, 'default');
    const result = pack.result || pack;
    const scorePct = result.scorePct ?? 0;
    const pass = !!result.pass;

    paintGradedChips(result);
    showLineResult({ scorePct, pass });

    pushHistory({
      at: Date.now(),
      text,
      scorePct,
      pass,
      source: source || 'practice',
      words: result.words || [],
    });
    renderHistory();
  } catch (err) {
    console.error(err);
    showLineResult({ scorePct: 0, pass: false });
  } finally {
    btnRecord.disabled = !engineReady;
    btnRecord.textContent = t('tapMic', ui);
    btnRecord.classList.remove('recording');
  }
}

async function onRecord() {
  const text = currentLine();
  if (!text) {
    alert(t('emptyText', ui));
    return;
  }
  if (recording) return;
  recording = true;
  btnRecord.classList.add('recording');
  btnRecord.textContent = t('recording', ui);
  paintPendingChips(text);
  lineResult.hidden = true;
  try {
    const blob = await recordOnce();
    await runGrade(blob, 'practice');
  } catch (err) {
    console.error(err);
    if (err?.name === 'NotAllowedError') alert(t('micDenied', ui));
  } finally {
    recording = false;
  }
}

function bindVoiceButtons() {
  document.querySelectorAll('.voice-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.voice-btn').forEach((b) => {
        b.classList.toggle('is-on', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      setVoice(btn.dataset.voice);
    });
  });
}

function renderBooksList() {
  if (!booksData || !bookList) return;
  bookList.innerHTML = '';
  bookDetail.hidden = true;
  bookList.hidden = false;
  booksData.packs.forEach((pack) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'book-card';
    const title = pack.title[ui] || pack.title.en;
    const sub = pack.title.ko && ui !== 'ko' ? pack.title.ko : `${pack.phrases.length} phrases`;
    btn.innerHTML = `<div class="book-card-title">${title}</div><div class="book-card-sub">${sub}</div>`;
    btn.addEventListener('click', () => openBook(pack));
    bookList.appendChild(btn);
  });
}

function openBook(pack) {
  bookList.hidden = true;
  bookDetail.hidden = false;
  const title = pack.title[ui] || pack.title.en;
  bookDetail.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'back-books';
  back.textContent = '← ' + (pack.title.en || title);
  back.addEventListener('click', () => renderBooksList());
  bookDetail.appendChild(back);
  const ul = document.createElement('ul');
  ul.className = 'phrase-list';
  pack.phrases.forEach((ph) => {
    const li = document.createElement('li');
    li.className = 'phrase-item';
    const l1 = ph[ui] || ph.ko || '';
    li.innerHTML = `<div class="phrase-en">${ph.en}</div>${l1 ? `<div class="phrase-l1">${l1}</div>` : ''}`;
    li.addEventListener('click', () => {
      practiceText.value = ph.en;
      paintPendingChips(ph.en);
      showTab('practice');
    });
    ul.appendChild(li);
  });
  bookDetail.appendChild(ul);
}

function renderGuides() {
  const guides = loadGuides();
  guidesList.innerHTML = '';
  guides.forEach((g, idx) => {
    const li = document.createElement('li');
    li.className = 'guide-row';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = g.title || `Guide ${idx + 1}`;
    open.addEventListener('click', () => editGuide(idx));
    li.appendChild(open);
    guidesList.appendChild(li);
  });
}

function editGuide(index) {
  const guides = loadGuides();
  const g = guides[index] || { title: '', lines: [] };
  guideEditor.hidden = false;
  guideEditor.innerHTML = '';
  const titleIn = document.createElement('input');
  titleIn.type = 'text';
  titleIn.placeholder = 'Guide title';
  titleIn.value = g.title || '';
  titleIn.className = 'field';
  const area = document.createElement('textarea');
  area.value = (g.lines || []).join('\n');
  area.placeholder = 'One English sentence per line (max 20)';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn primary';
  save.textContent = t('saveGuide', ui);
  save.addEventListener('click', () => {
    const lines = area.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, MAX_SENTENCES_PER_GUIDE);
    const next = loadGuides();
    next[index] = { title: titleIn.value.trim() || 'My guide', lines, updated: Date.now() };
    saveGuides(next);
    guideEditor.hidden = true;
    renderGuides();
  });
  guideEditor.append(titleIn, area, save);
}

function renderHistory() {
  const q = (historySearch?.value || '').toLowerCase();
  let entries = loadHistory();
  if (q) entries = entries.filter((e) => (e.text || '').toLowerCase().includes(q));
  const passN = entries.filter((e) => e.pass).length;
  if (historyStats) historyStats.textContent = t('historyStats', ui, { n: entries.length, pass: passN });
  historyList.innerHTML = '';
  entries.slice(0, 100).forEach((e) => {
    const li = document.createElement('li');
    li.className = 'history-row';
    const d = new Date(e.at);
    li.innerHTML = `<div><div>${e.text}</div><div class="history-row-meta">${d.toLocaleString()} · ${e.source || ''}</div></div><div class="${e.pass ? 'history-pass' : 'history-fail'}">${e.scorePct}%</div>`;
    li.addEventListener('click', () => {
      practiceText.value = e.text;
      paintPendingChips(e.text);
      showTab('practice');
    });
    historyList.appendChild(li);
  });
}

async function loadBooks() {
  const url = new URL('content/books.json', import.meta.url);
  const res = await fetch(url);
  booksData = await res.json();
  renderBooksList();
}

async function boot() {
  fillLangSelect(uiLang, ui);
  applyI18n(ui);
  bindVoiceButtons();

  uiLang.addEventListener('change', () => {
    ui = uiLang.value;
    setUiLang(ui);
    applyI18n(ui);
    paintPracticeHint();
    renderBooksList();
    renderHistory();
    btnRecord.textContent = t('tapMic', ui);
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });

  btnListen?.addEventListener('click', () => speak(currentLine()));
  btnRecord?.addEventListener('click', () => onRecord());
  practiceText?.addEventListener('input', () => {
    paintPendingChips(currentLine());
    lineResult.hidden = true;
  });

  $('#btnNewGuide')?.addEventListener('click', () => {
    const guides = loadGuides();
    if (guides.length >= MAX_GUIDES) {
      alert(`Max ${MAX_GUIDES} guides`);
      return;
    }
    guides.push({ title: 'New guide', lines: [], updated: Date.now() });
    saveGuides(guides);
    editGuide(guides.length - 1);
    renderGuides();
  });

  historySearch?.addEventListener('input', () => renderHistory());
  $('#btnExportJson')?.addEventListener('click', () => {
    downloadText('pronounce-practice-history.json', exportHistoryJson(loadHistory()), 'application/json');
  });
  $('#btnExportCsv')?.addEventListener('click', () => {
    downloadText('pronounce-practice-history.csv', exportHistoryCsv(loadHistory()), 'text/csv');
  });

  renderGuides();
  renderHistory();
  void loadBooks();

  void initTts((msg) => {
    if (msg && bootStatus) bootStatus.textContent = msg;
  }).then(() => {
    const note = ttsNoteText();
    if (note && ttsNote) {
      ttsNote.textContent = note;
      ttsNote.hidden = getTtsMode() === 'kokoro';
    }
  });

  try {
    const bootOpts = {
      onProgress: (p, label) => {
        setBootProgress(p * 0.95, label || bootStatus?.textContent);
      },
    };
    uiBoot = await bootSharedForUi(bootOpts);
    hideBoot();
    paintPracticeHint();
    if (getModelBootState() === 'ready') {
      engineReady = true;
      btnRecord.disabled = false;
      setModelStatus(t('checkerReady', ui));
    } else {
      setModelStatus(t('basicListen', ui));
      void finishCheckerLoad();
    }
  } catch (err) {
    console.error(err);
    hideBoot();
    setModelStatus(t('checkerFailed', ui), true);
    paintPracticeHint();
  }

  btnRetryChecker?.addEventListener('click', () => {
    void retryChecker();
  });

  paintPendingChips(currentLine());
}

boot();
