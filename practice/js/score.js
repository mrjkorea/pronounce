/**
 * Scorebook wiring for the practice page (Reg/Metrics, 2026-11-11).
 *
 * One row per finished phrase, posted the same way the Day 4 app posts:
 * window.MRJ_SCORES.post() -> ClassroomMetrics, plus MRJ_AUTH.noteScore()
 * -> the student score index. No student, no row.
 *
 * Item id: pronounce:practice:<hash of the phrase>. The phrase text is the
 * identity, so a retry of the same phrase appends a row on the same canonical
 * item id (house rule: same id, metadata attempt / re_attempt), and the same
 * line typed from Books, a Guide or the free box is one item.
 */
export const PRACTICE_PROGRAM = 'pronounce';
export const PRACTICE_APP_NAME = 'MRJ Pronounce Practice';
export const PRACTICE_SOURCE = 'pronounce-practice';
export const ITEM_PREFIX = `${PRACTICE_PROGRAM}:practice:`;

/** Trim and collapse spaces; the grader and the book see the same text. */
export function normalizePhrase(text) {
  return String(text == null ? '' : text)
    .trim()
    .replace(/\s+/g, ' ');
}

/** FNV-1a, 32 bit, hex. Same phrase -> same id on every device. */
export function phraseHash(text) {
  const s = normalizePhrase(text).toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function phraseItemId(text) {
  return `${ITEM_PREFIX}${phraseHash(text)}`;
}

/** How many earlier tries of this same phrase the device already keeps. */
export function countAttempts(history, text) {
  const key = normalizePhrase(text).toLowerCase();
  if (!key || !Array.isArray(history)) return 0;
  let n = 0;
  history.forEach((e) => {
    if (normalizePhrase(e && e.text).toLowerCase() === key) n += 1;
  });
  return n;
}

export function phrasePassed(graded) {
  if (!graded) return false;
  if (typeof graded.pass === 'boolean') return graded.pass;
  const pct = Number(graded.scorePct) || 0;
  return pct >= 60 && !graded.doorFail;
}

/** noteScore payload for the student score index, same shape Day 4 sends. */
export function buildNoteScoreArgs(itemId, scorePct, localDate) {
  const pct = Math.round(Number(scorePct) || 0);
  return {
    program: PRACTICE_PROGRAM,
    itemId,
    scoreValue: pct,
    scoreMax: 100,
    scorePct: pct,
    localDate: localDate || '',
  };
}

/**
 * One finished phrase -> one ClassroomMetrics row.
 * Never invents completed or duration: the practice page does not measure them.
 */
export function buildPracticePost({ text, graded, pack, attempt, student }) {
  const english = normalizePhrase(text);
  const pct = Math.round(Number(graded?.scorePct) || 0);
  const pass = phrasePassed(graded);
  const n = Number(attempt) > 0 ? Math.round(Number(attempt)) : 1;
  const metadata = {
    english,
    attempt: n,
    re_attempt: n > 1,
    pass,
    grader: graded?.grader || 'hubert-phoneme',
  };
  if (graded?.band) metadata.band = graded.band;
  if (Array.isArray(graded?.weak) && graded.weak.length) metadata.weak = graded.weak;
  if (Array.isArray(graded?.yellowWords) && graded.yellowWords.length) {
    metadata.yellowWords = graded.yellowWords;
  }
  if (graded?.doorFail) metadata.doorFail = true;
  if (pack && pack.id) metadata.pack_id = pack.id;
  if (pack && Number.isInteger(pack.phraseIndex)) metadata.pack_phrase_index = pack.phraseIndex + 1;

  return {
    student,
    program: PRACTICE_PROGRAM,
    appName: PRACTICE_APP_NAME,
    source: PRACTICE_SOURCE,
    itemId: phraseItemId(english),
    itemType: 'pronunciation',
    bookTitle: pack && pack.title ? String(pack.title) : '',
    scoreValue: pct,
    scoreMax: 100,
    scorePct: pct,
    correctness: pass ? 'correct' : 'incorrect',
    metadata,
  };
}

/**
 * Post one finished phrase. Returns what was sent, so a test or the page can
 * prove the call happened without touching the network.
 */
export function reportPhraseScore({
  text,
  graded,
  pack = null,
  history = [],
  attempt: attemptIn = 0,
  auth,
  scores,
  localDateFn,
} = {}) {
  const english = normalizePhrase(text);
  const empty = { posted: false, reason: 'no_phrase', noteScoreArgs: null, post: null };
  if (!english || !graded) return empty;
  if (!scores || typeof scores.post !== 'function') {
    return { ...empty, reason: 'no_score_client' };
  }
  let student = '';
  try {
    student = auth && typeof auth.student === 'function' ? String(auth.student() || '').trim() : '';
  } catch (e) {
    student = '';
  }
  if (!student) return { ...empty, reason: 'no_student' };

  const given = Number(attemptIn) || 0;
  const attempt = given > 0 ? Math.round(given) : countAttempts(history, english) + 1;
  const localDate = typeof localDateFn === 'function' ? localDateFn() : '';
  const post = buildPracticePost({ text: english, graded, pack, attempt, student });
  let noteScoreArgs = null;
  if (auth && typeof auth.noteScore === 'function') {
    noteScoreArgs = buildNoteScoreArgs(post.itemId, post.scorePct, localDate);
    try {
      auth.noteScore(noteScoreArgs);
    } catch (e) {
      noteScoreArgs = null;
    }
  }
  try {
    scores.post(post);
  } catch (e) {
    return { posted: false, reason: 'post_failed', noteScoreArgs, post };
  }
  return { posted: true, reason: '', noteScoreArgs, post, attempt };
}
