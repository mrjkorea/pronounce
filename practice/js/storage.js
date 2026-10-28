const GUIDES_KEY = 'pronounce-practice-guides-v1';
const HISTORY_KEY = 'pronounce-practice-history-v1';
export const MAX_GUIDES = 200;
export const MAX_SENTENCES_PER_GUIDE = 20;
export const MAX_HISTORY = 5000;
export const HISTORY_DAYS = 365;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (_) {}
}

export function loadGuides() {
  return read(GUIDES_KEY, []);
}

export function saveGuides(list) {
  write(GUIDES_KEY, list.slice(0, MAX_GUIDES));
}

export function pruneHistory(entries) {
  const cutoff = Date.now() - HISTORY_DAYS * 86400000;
  return entries
    .filter((e) => e.at >= cutoff)
    .slice(0, MAX_HISTORY);
}

export function loadHistory() {
  return pruneHistory(read(HISTORY_KEY, []));
}

export function pushHistory(entry) {
  const list = loadHistory();
  list.unshift(entry);
  write(HISTORY_KEY, pruneHistory(list));
  return loadHistory();
}

export function exportHistoryJson(entries) {
  return JSON.stringify(entries, null, 2);
}

export function exportHistoryCsv(entries) {
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['at', 'text', 'scorePct', 'pass', 'source'].join(',')];
  entries.forEach((e) => {
    rows.push([e.at, esc(e.text), e.scorePct, e.pass, esc(e.source)].join(','));
  });
  return rows.join('\n');
}

export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
