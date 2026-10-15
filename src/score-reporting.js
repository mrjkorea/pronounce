import { authStudentId } from './progress-merge.js';

export const PROGRAM = 'pronounce';

export function prefixedItemId(itemId) {
  return `pronounce:${String(itemId || '')}`;
}

export function attemptErrorReason(thrown) {
  return thrown && thrown.code === 'too_short' ? 'too_short' : 'check_failed';
}

export function buildNoteScoreArgs(itemId, scorePct, localDate) {
  const pct = Math.round(scorePct);
  return {
    program: PROGRAM,
    itemId: prefixedItemId(itemId),
    scoreValue: pct,
    scoreMax: 100,
    scorePct: pct,
    localDate,
  };
}

export function buildCmSuccessPost(itemId, graded, meta, student) {
  const pct = Math.round(graded.scorePct);
  const metadata = {
    english: graded.english || '',
    weak: graded.weak || [],
  };
  if (graded.band) metadata.band = graded.band;
  if (graded.assistedPass != null) metadata.assistedPass = !!graded.assistedPass;
  if (Array.isArray(graded.yellowWords) && graded.yellowWords.length) {
    metadata.yellowWords = graded.yellowWords;
  }
  return {
    student,
    program: PROGRAM,
    appName: 'MRJ Pronounce Day 4',
    source: 'pronounce',
    itemId: prefixedItemId(itemId),
    itemType: 'pronunciation',
    bookTitle: meta?.bookId || '',
    unitTitle: meta?.unitId || '',
    scoreValue: pct,
    scoreMax: 100,
    scorePct: pct,
    correctness: graded.pass ? 'correct' : 'incorrect',
    metadata,
  };
}

export function buildCmAttemptErrorPost(itemId, meta, student, reason) {
  return {
    student,
    program: PROGRAM,
    appName: 'MRJ Pronounce Day 4',
    source: 'pronounce',
    itemId: prefixedItemId(itemId),
    itemType: 'attempt_error',
    bookTitle: meta?.bookId || '',
    unitTitle: meta?.unitId || '',
    metadata: { reason },
  };
}

/**
 * Persist CM + SSI for a finished student attempt. Never noteScore on thrown (ungraded) tries.
 */
export function reportScoredActivity({
  itemId,
  record,
  thrown,
  meta,
  auth,
  mrjScores,
  localDateFn,
}) {
  if (!itemId || !auth || !mrjScores) {
    return { noteScoreCalls: 0, noteScoreArgs: null, cmPosts: [] };
  }
  const studentVal = typeof auth.student === 'function' ? auth.student() : '';
  if (!authStudentId(studentVal)) {
    return { noteScoreCalls: 0, noteScoreArgs: null, cmPosts: [] };
  }
  const who = authStudentId(studentVal);
  if (!who) {
    return { noteScoreCalls: 0, noteScoreArgs: null, cmPosts: [] };
  }

  const cmPosts = [];
  if (thrown) {
    const reason = attemptErrorReason(thrown);
    const payload = buildCmAttemptErrorPost(itemId, meta, who, reason);
    cmPosts.push(payload);
    mrjScores.post(payload);
    return { noteScoreCalls: 0, noteScoreArgs: null, cmPosts };
  }

  if (!record) {
    return { noteScoreCalls: 0, noteScoreArgs: null, cmPosts: [] };
  }

  let noteScoreCalls = 0;
  let noteScoreArgs = null;
  const localDate = typeof localDateFn === 'function' ? localDateFn() : '';
  if (typeof auth.noteScore === 'function') {
    noteScoreArgs = buildNoteScoreArgs(itemId, record.scorePct, localDate);
    auth.noteScore(noteScoreArgs);
    noteScoreCalls = 1;
  }
  const payload = buildCmSuccessPost(itemId, record, meta, who);
  cmPosts.push(payload);
  mrjScores.post(payload);
  return { noteScoreCalls, noteScoreArgs, cmPosts };
}
