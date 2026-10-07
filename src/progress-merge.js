/** Pure merge / gating helpers for pronounce score sync (Node-testable). */

export const LEGACY_SCORE_KEY = 'day4-pronounce-scores-v2';
export const SCORE_KEY_PREFIX = 'day4-pronounce-scores-v2:';
export const PROGRAM = 'pronounce';
export const REMOTE_SAVE_MIN_MS = 17000;
export const PACK_LOAD_BACKOFF_MS = [0, 1500, 4000];

export function idKey(id) {
  return String(id == null ? '' : id)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function authStudentId(student) {
  if (student == null) return '';
  if (typeof student === 'string') return String(student).trim();
  if (typeof student === 'object' && student.id != null) return String(student.id).trim();
  return '';
}

export function studentScoreStorageKey(studentId) {
  const key = idKey(studentId);
  return key ? `${SCORE_KEY_PREFIX}${key}` : LEGACY_SCORE_KEY;
}

export function parsePackJson(text) {
  const raw = text == null ? '' : String(text).trim();
  if (!raw) return { scores: {}, unparseable: false };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { scores: {}, unparseable: true };
    }
    return { scores: parsed, unparseable: false };
  } catch (_) {
    return { scores: {}, unparseable: true };
  }
}

function attemptId(row) {
  if (!row || typeof row !== 'object') return '';
  if (row.id != null && String(row.id)) return String(row.id);
  if (row.at != null && Number.isFinite(Number(row.at))) return `at:${row.at}`;
  return '';
}

function snapshotAttempt(record) {
  if (!record || typeof record !== 'object') return null;
  const at = Number(record.at);
  return {
    id: attemptId(record),
    scorePct: Number(record.scorePct) || 0,
    score: Number(record.score) || 0,
    pass: !!record.pass,
    at: Number.isFinite(at) ? at : 0,
    english: record.english || '',
    weak: Array.isArray(record.weak) ? record.weak.slice() : [],
    words: Array.isArray(record.words) ? record.words.slice() : [],
    reason: record.reason || '',
  };
}

function unionAttempts(a, b) {
  const list = [];
  const seen = new Set();
  const add = (record) => {
    const snap = snapshotAttempt(record);
    if (!snap) return;
    const key = snap.id || `at:${snap.at}:${snap.scorePct}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(snap);
  };
  if (Array.isArray(a && a.attempts)) a.attempts.forEach(add);
  else add(a);
  if (Array.isArray(b && b.attempts)) b.attempts.forEach(add);
  else add(b);
  list.sort((x, y) => {
    const ax = x.at || 0;
    const ay = y.at || 0;
    if (ax !== ay) return ax - ay;
    return String(x.id).localeCompare(String(y.id));
  });
  return list;
}

function bestFromAttempts(attempts, passPct) {
  if (!attempts.length) return null;
  let best = attempts[0];
  for (let i = 1; i < attempts.length; i++) {
    const row = attempts[i];
    const bp = Number(best.scorePct) || 0;
    const rp = Number(row.scorePct) || 0;
    if (rp > bp) best = row;
    else if (rp === bp && (row.at || 0) < (best.at || 0)) best = row;
  }
  const pct = Number(best.scorePct) || 0;
  let earliestAt = Infinity;
  for (let i = 0; i < attempts.length; i++) {
    const t = Number(attempts[i].at);
    if (Number.isFinite(t)) earliestAt = Math.min(earliestAt, t);
  }
  if (!Number.isFinite(earliestAt)) earliestAt = best.at || 0;
  return {
    scorePct: pct,
    score: Number(best.score) || pct / 100,
    pass: best.pass || pct >= passPct,
    at: earliestAt,
    english: best.english || '',
    weak: Array.isArray(best.weak) ? best.weak.slice() : [],
    words: Array.isArray(best.words) ? best.words.slice() : [],
    reason: best.reason || '',
    attempts,
  };
}

export function mergeScoreRecord(a, b, passPct = 60) {
  if (!a && !b) return null;
  if (!a) return bestFromAttempts(unionAttempts(null, b), passPct);
  if (!b) return bestFromAttempts(unionAttempts(a, null), passPct);
  const attempts = unionAttempts(a, b);
  return bestFromAttempts(attempts, passPct);
}

export function mergeScoreMaps(local, remote, passPct = 60) {
  const left = local && typeof local === 'object' ? local : {};
  const right = remote && typeof remote === 'object' ? remote : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const out = {};
  for (const key of keys) {
    const merged = mergeScoreRecord(left[key], right[key], passPct);
    if (merged) out[key] = merged;
  }
  return out;
}

export function filterProgressRows(rows, program = PROGRAM) {
  const want = String(program || '').trim().toLowerCase();
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const prog = String(row.program || '').trim().toLowerCase();
    return prog === want;
  });
}

function normalizeProgressItemId(raw) {
  let id = String(raw || '').trim();
  if (!id) return '';
  const lower = id.toLowerCase();
  if (lower.startsWith('pronounce:')) id = id.slice('pronounce:'.length);
  return id;
}

function progressRowScorePct(row) {
  if (row == null || typeof row !== 'object') return 0;
  if (typeof row.scorePct === 'number' && Number.isFinite(row.scorePct)) return Math.round(row.scorePct);
  if (typeof row.scoreValue === 'number' && Number.isFinite(row.scoreValue)) {
    const max = typeof row.scoreMax === 'number' && row.scoreMax > 0 ? row.scoreMax : 100;
    return Math.round((row.scoreValue / max) * 100);
  }
  const score = row.score;
  if (typeof score === 'number' && Number.isFinite(score)) {
    return score <= 1 ? Math.round(score * 100) : Math.round(score);
  }
  if (typeof score === 'string') {
    const m = score.match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Number(m[1]);
      return Number.isFinite(n) ? (n <= 1 ? Math.round(n * 100) : Math.round(n)) : 0;
    }
  }
  return 0;
}

export function progressRowsToScores(rows, program = PROGRAM, passPct = 60) {
  const out = {};
  for (const row of filterProgressRows(rows, program)) {
    const itemId = normalizeProgressItemId(row.itemId || row.item);
    if (!itemId) continue;
    const scorePct = progressRowScorePct(row);
    let at = Number(row.at);
    if (!Number.isFinite(at) && row.date) {
      const parsed = Date.parse(row.date);
      at = Number.isFinite(parsed) ? parsed : Date.now();
    }
    if (!Number.isFinite(at)) at = Date.now();
    const seed = {
      scorePct,
      score: scorePct / 100,
      pass: scorePct >= passPct,
      at,
      english: '',
      weak: [],
      words: [],
      reason: '',
    };
    const merged = mergeScoreRecord(out[itemId], seed, passPct);
    if (merged) out[itemId] = merged;
  }
  return out;
}

export function packLoadAllowsSave(loadResult) {
  return !!(loadResult && loadResult.ok);
}

export async function loadPackWithRetry(loadPackFn, program, options = {}) {
  const delays = options.delays || PACK_LOAD_BACKOFF_MS;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }));
  let last = null;
  let attempts = 0;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    attempts += 1;
    last = await loadPackFn(program);
    if (packLoadAllowsSave(last)) {
      return { result: last, attempts, ok: true };
    }
  }
  return { result: last, attempts, ok: false };
}

/** Apply server pack + progress after network; re-read local so in-sync tries are kept. */
export function mergeScoresAfterServerFetch(readLocal, packJson, progressRows) {
  const parsed = parsePackJson(packJson);
  const packScores = parsed.scores;
  const progressScores = progressRowsToScores(progressRows || []);
  const serverMerged = mergeScoreMaps(packScores, progressScores);
  const freshLocal = typeof readLocal === 'function' ? readLocal() : {};
  return {
    merged: mergeScoreMaps(freshLocal, serverMerged),
    serverMerged,
    packScores,
    progressScores,
  };
}

export function buildPackSavePayload(localScores, loadedServerScores) {
  return mergeScoreMaps(localScores || {}, loadedServerScores || {});
}

export function shouldFlushPackOnPagehide(dirty, packLoadOk) {
  return !!packLoadOk && !!dirty;
}

export function scoresNeedSaveAfterSync(merged, serverMerged) {
  const left = merged && typeof merged === 'object' ? merged : {};
  const right = serverMerged && typeof serverMerged === 'object' ? serverMerged : {};
  for (const key of Object.keys(left)) {
    const local = left[key];
    const remote = right[key];
    if (!remote) return true;
    const lp = Number(local && local.scorePct) || 0;
    const rp = Number(remote && remote.scorePct) || 0;
    if (lp > rp) return true;
  }
  return false;
}

export function readScoresFromStorage(storage, key) {
  try {
    const raw = JSON.parse(storage.getItem(key) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_) {
    return {};
  }
}

/** Shared classroom devices: the legacy key may mix many students — never read or merge it. */
export function loadStudentScoresOnly(storage, studentId) {
  return readScoresFromStorage(storage, studentScoreStorageKey(studentId));
}
