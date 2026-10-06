/** Part 1 lock / teacher skip / part 2 timer. Pure: no DOM, no ONNX. */

export const FLOW_STORAGE_KEY = 'day4-pronounce-two-parts-v1';
export const LEGACY_SCORE_KEY = 'day4-pronounce-scores-v2';
export const LOCK_AT = 5;
export const LOCK_TEXT = 'Please ask your teacher for help.';
export const TEACHER_PASSWORD = 'MRJ';

export function emptyFlow() {
  return {
    phase: 'part1',
    fails: {},
    student: {},
    attempts: {},
    teacher: {},
    rushRecorded: {},
    rushGrades: {},
    part2: {
      wordCount: 0,
      limitSec: 60,
      startedAt: 0,
      stoppedAt: 0,
      secondsUsed: null,
    },
  };
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function whole(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeFlow(raw) {
  const base = emptyFlow();
  if (!raw || typeof raw !== 'object') return base;
  const phase = raw.phase === 'teacher' || raw.phase === 'part2' || raw.phase === 'results' ? raw.phase : 'part1';
  const limit = raw.part2 && Number(raw.part2.limitSec) === 90 ? 90 : 60;
  const seconds = raw.part2 && raw.part2.secondsUsed != null ? whole(raw.part2.secondsUsed) : null;
  return {
    phase,
    fails: plainObject(raw.fails),
    student: plainObject(raw.student),
    attempts: plainObject(raw.attempts),
    teacher: plainObject(raw.teacher),
    rushRecorded: plainObject(raw.rushRecorded),
    rushGrades: plainObject(raw.rushGrades),
    part2: {
      wordCount: whole(raw.part2 && raw.part2.wordCount),
      limitSec: limit,
      startedAt: whole(raw.part2 && raw.part2.startedAt),
      stoppedAt: whole(raw.part2 && raw.part2.stoppedAt),
      secondsUsed: seconds,
    },
  };
}

/** A word is a token of letters or numbers. Apostrophes stay inside the token. */
export function countWords(text) {
  const found = String(text || '').match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*/g);
  return found ? found.length : 0;
}

export function sumWords(texts) {
  return (texts || []).reduce((n, text) => n + countWords(text), 0);
}

/** More than 50 English words → 90 seconds. 50 or fewer → 60. */
export function timerSeconds(wordCount) {
  return wordCount > 50 ? 90 : 60;
}

export function isLocked(flow, id) {
  return (flow.fails[id] || 0) >= LOCK_AT;
}

export function studentPassed(flow, id) {
  return !!(flow.student[id] && flow.student[id].pass);
}

export function isFinished(flow, id) {
  return studentPassed(flow, id) || isLocked(flow, id);
}

export function part1Complete(flow, ids) {
  return ids.length > 0 && ids.every((id) => isFinished(flow, id));
}

export function stuckIds(flow, ids) {
  return ids.filter((id) => {
    if (!isLocked(flow, id) || studentPassed(flow, id)) return false;
    const mark = flow.teacher[id];
    return mark !== 'passed' && mark !== 'skipped';
  });
}

export function noteAttempt(flow, id, graded) {
  const attempts = Object.assign({}, flow.attempts, { [id]: graded });
  if (graded && graded.pass) {
    const student = Object.assign({}, flow.student, {
      [id]: { pass: true, score: graded.score, scorePct: graded.scorePct },
    });
    return Object.assign({}, flow, { attempts, student });
  }
  const fails = Object.assign({}, flow.fails, { [id]: (flow.fails[id] || 0) + 1 });
  return Object.assign({}, flow, { attempts, fails });
}

export function noteTeacherPass(flow, id) {
  const teacher = Object.assign({}, flow.teacher, { [id]: 'passed' });
  return Object.assign({}, flow, { teacher });
}

export function markRushRecorded(flow, id) {
  const rushRecorded = Object.assign({}, flow.rushRecorded, { [id]: true });
  return Object.assign({}, flow, { rushRecorded });
}

function storedRushWords(graded) {
  const list = graded && Array.isArray(graded.words) ? graded.words : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!row || !row.word) continue;
    const score = Number(row.score);
    out.push({ word: String(row.word), score: Number.isFinite(score) ? score : 0 });
  }
  return out;
}

export function noteRushGrade(flow, id, graded) {
  const rushGrades = Object.assign({}, flow.rushGrades, {
    [id]: {
      pass: !!(graded && graded.pass),
      scorePct: graded && graded.scorePct ? graded.scorePct : 0,
      words: storedRushWords(graded),
    },
  });
  return Object.assign({}, flow, { rushGrades });
}

export function enterPart2(flow, wordCount) {
  return Object.assign({}, flow, {
    phase: 'part2',
    part2: {
      wordCount,
      limitSec: timerSeconds(wordCount),
      startedAt: 0,
      stoppedAt: 0,
      secondsUsed: null,
    },
  });
}

export function advanceFlow(flow, ids, wordCount) {
  if (flow.phase === 'part2' || flow.phase === 'results') return flow;
  if (flow.phase === 'part1') {
    if (!part1Complete(flow, ids)) return flow;
    if (stuckIds(flow, ids).length) return Object.assign({}, flow, { phase: 'teacher' });
    return enterPart2(flow, wordCount);
  }
  if (flow.phase === 'teacher') {
    if (stuckIds(flow, ids).length) return flow;
    return enterPart2(flow, wordCount);
  }
  return flow;
}

/** Password works on the teacher screen only. It does not count during the five tries. */
export function acceptTeacherPassword(phase, text) {
  if (phase !== 'teacher') return false;
  return String(text || '').trim() === TEACHER_PASSWORD;
}

export function tryTeacherPassword(flow, ids, wordCount, text) {
  if (!acceptTeacherPassword(flow.phase, text)) return { ok: false, flow };
  const teacher = Object.assign({}, flow.teacher);
  const stuck = stuckIds(flow, ids);
  for (let i = 0; i < stuck.length; i++) teacher[stuck[i]] = 'skipped';
  const next = advanceFlow(Object.assign({}, flow, { teacher }), ids, wordCount);
  return { ok: true, flow: next };
}

export function timerRunning(flow, now) {
  const t = now || Date.now();
  if (flow.phase !== 'part2') return false;
  const part = flow.part2;
  if (!part.startedAt || part.stoppedAt) return false;
  return (t - part.startedAt) < part.limitSec * 1000;
}

export function startTimer(flow, now) {
  if (flow.phase !== 'part2' || flow.part2.startedAt) return flow;
  const part2 = Object.assign({}, flow.part2, { startedAt: now, stoppedAt: 0, secondsUsed: null });
  return Object.assign({}, flow, { part2 });
}

export function stopTimer(flow, now) {
  if (flow.phase !== 'part2' || !flow.part2.startedAt || flow.part2.stoppedAt) return flow;
  const limit = flow.part2.limitSec;
  const used = Math.min(limit, Math.max(0, Math.round((now - flow.part2.startedAt) / 1000)));
  const part2 = Object.assign({}, flow.part2, { stoppedAt: now, secondsUsed: used });
  return Object.assign({}, flow, { phase: 'results', part2 });
}

export function reconcileFlow(flow, now) {
  if (!timerRunning(flow, now) && flow.phase === 'part2' && flow.part2.startedAt && !flow.part2.stoppedAt) {
    const limitMs = flow.part2.limitSec * 1000;
    return stopTimer(flow, flow.part2.startedAt + limitMs);
  }
  return flow;
}

/**
 * Next mic policy.
 * A grade, a fail sound, or rushInFlight does not block the next mic.
 * A recording still blocks, because only one take runs at a time.
 * Part 2 also needs the timer to be running.
 */
export function canStartMic({ phase, recording, timerRunning: running, lineOpen }) {
  if (lineOpen === false) return false;
  if (recording) return false;
  if (phase === 'part1' || phase === 'teacher') return true;
  if (phase === 'part2') return !!running;
  return false;
}

export function lineOpenFor(flow, id) {
  if (flow.phase === 'part1') return !isLocked(flow, id) && !studentPassed(flow, id);
  if (flow.phase === 'teacher') return stuckIds(flow, [id]).length === 1;
  if (flow.phase === 'part2') {
    if (!timerRunning(flow)) return false;
    const grade = flow.rushGrades[id];
    if (grade && grade.pass) return false;
    return true;
  }
  return false;
}

export function resultsView(flow, lines) {
  const list = lines || [];
  const skipped = [];
  const teacherSaid = [];
  let passed = 0;
  let recorded = 0;
  let rushPassed = 0;
  for (let i = 0; i < list.length; i++) {
    const line = list[i];
    if (studentPassed(flow, line.id)) passed += 1;
    if (flow.rushRecorded[line.id]) recorded += 1;
    if (flow.rushGrades[line.id] && flow.rushGrades[line.id].pass) rushPassed += 1;
    if (flow.teacher[line.id] === 'skipped') {
      skipped.push({ id: line.id, label: line.korean || line.id, mark: 'skipped' });
    } else if (flow.teacher[line.id] === 'passed') {
      teacherSaid.push({ id: line.id, label: line.korean || line.id, mark: 'teacher' });
    }
  }
  return {
    secondsUsed: flow.part2.secondsUsed == null ? 0 : flow.part2.secondsUsed,
    limitSec: flow.part2.limitSec,
    recorded,
    rushPassed,
    total: list.length,
    passed,
    skipped,
    teacherSaid,
  };
}
