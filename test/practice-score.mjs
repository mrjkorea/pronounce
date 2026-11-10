import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRACTICE_APP_NAME,
  PRACTICE_PROGRAM,
  buildNoteScoreArgs,
  buildPracticePost,
  countAttempts,
  phraseItemId,
  reportPhraseScore,
} from '../practice/js/score.js';

const LOCAL_DATE = '2026-11-11';
const PHRASE = 'How are you?';

function mockAuth(student = 'zz_test_pronounce', withScore = true) {
  const calls = [];
  return {
    student: () => student,
    noteScore: withScore
      ? (args) => {
          calls.push(args);
        }
      : undefined,
    noteScoreCalls: calls,
  };
}

function mockScores() {
  const posts = [];
  return {
    posts,
    post: (opts) => {
      posts.push(opts);
      return Promise.resolve({ status: 'mock' });
    },
    localDate: () => LOCAL_DATE,
  };
}

test('item id is stable for one phrase and differs for another', () => {
  assert.equal(phraseItemId(PHRASE), phraseItemId('  how are   you?  '));
  assert.match(phraseItemId(PHRASE), /^pronounce:practice:[0-9a-f]{8}$/);
  assert.notEqual(phraseItemId(PHRASE), phraseItemId('How are you'));
});

test('one finished phrase posts one row on the canonical item id', () => {
  const auth = mockAuth();
  const scores = mockScores();
  const graded = { scorePct: 82.4, pass: true, band: 'green', weak: [], english: PHRASE };

  const out = reportPhraseScore({
    text: PHRASE,
    graded,
    history: [],
    auth,
    scores,
    localDateFn: () => LOCAL_DATE,
  });

  assert.equal(out.posted, true);
  assert.equal(scores.posts.length, 1);
  assert.equal(auth.noteScoreCalls.length, 1);

  const post = scores.posts[0];
  assert.equal(post.program, PRACTICE_PROGRAM);
  assert.equal(post.appName, PRACTICE_APP_NAME);
  assert.equal(post.itemId, phraseItemId(PHRASE));
  assert.equal(post.itemType, 'pronunciation');
  assert.equal(post.student, 'zz_test_pronounce');
  assert.equal(post.scoreValue, 82);
  assert.equal(post.scoreMax, 100);
  assert.equal(post.scorePct, 82);
  assert.equal(post.correctness, 'correct');
  assert.equal(post.completed, undefined);
  assert.equal(post.durationSeconds, undefined);
  assert.equal(post.metadata.attempt, 1);
  assert.equal(post.metadata.re_attempt, false);
  assert.equal(post.metadata.english, PHRASE);
});

test('retry of the same phrase keeps the id and marks attempt 2', () => {
  const auth = mockAuth();
  const scores = mockScores();
  const history = [{ text: PHRASE, scorePct: 40, pass: false }];

  const out = reportPhraseScore({
    text: PHRASE,
    graded: { scorePct: 74, pass: true },
    history,
    auth,
    scores,
    localDateFn: () => LOCAL_DATE,
  });

  assert.equal(out.attempt, 2);
  assert.equal(scores.posts[0].itemId, phraseItemId(PHRASE));
  assert.equal(scores.posts[0].metadata.attempt, 2);
  assert.equal(scores.posts[0].metadata.re_attempt, true);
  assert.equal(auth.noteScoreCalls[0].itemId, phraseItemId(PHRASE));
});

test('explicit attempt wins so one try never counts itself twice', () => {
  const scores = mockScores();
  const out = reportPhraseScore({
    text: PHRASE,
    graded: { scorePct: 88, pass: true },
    attempt: 1,
    // history already holds the try we just pushed: the page passes the number it counted
    history: [{ text: PHRASE }],
    auth: mockAuth(),
    scores,
    localDateFn: () => LOCAL_DATE,
  });
  assert.equal(out.attempt, 1);
  assert.equal(scores.posts[0].metadata.attempt, 1);
  assert.equal(scores.posts[0].metadata.re_attempt, false);
});

test('no student means no row and no noteScore', () => {
  const auth = mockAuth('');
  const scores = mockScores();
  const out = reportPhraseScore({
    text: PHRASE,
    graded: { scorePct: 90, pass: true },
    auth,
    scores,
    localDateFn: () => LOCAL_DATE,
  });
  assert.equal(out.posted, false);
  assert.equal(out.reason, 'no_student');
  assert.equal(scores.posts.length, 0);
  assert.equal(auth.noteScoreCalls.length, 0);
});

test('no score client means no row, page keeps working', () => {
  const out = reportPhraseScore({
    text: PHRASE,
    graded: { scorePct: 90, pass: true },
    auth: mockAuth(),
    scores: null,
  });
  assert.equal(out.posted, false);
  assert.equal(out.reason, 'no_score_client');
});

test('empty phrase posts nothing', () => {
  const scores = mockScores();
  const out = reportPhraseScore({
    text: '   ',
    graded: { scorePct: 90, pass: true },
    auth: mockAuth(),
    scores,
  });
  assert.equal(out.posted, false);
  assert.equal(scores.posts.length, 0);
});

test('door fail posts an incorrect row with score 0', () => {
  const post = buildPracticePost({
    text: PHRASE,
    graded: { scorePct: 0, pass: false, doorFail: true, weak: ['how', 'you'] },
    attempt: 1,
    student: 'zz_test_pronounce',
  });
  assert.equal(post.scorePct, 0);
  assert.equal(post.correctness, 'incorrect');
  assert.equal(post.metadata.doorFail, true);
  assert.deepEqual(post.metadata.weak, ['how', 'you']);
});

test('book phrase carries pack id and 1-based phrase number', () => {
  const post = buildPracticePost({
    text: PHRASE,
    graded: { scorePct: 70, pass: true },
    pack: { id: 'greetings', title: 'Greetings', phraseIndex: 6 },
    attempt: 1,
    student: 'zz_test_pronounce',
  });
  assert.equal(post.bookTitle, 'Greetings');
  assert.equal(post.metadata.pack_id, 'greetings');
  assert.equal(post.metadata.pack_phrase_index, 7);
});

test('noteScore args match the Day 4 shape', () => {
  const args = buildNoteScoreArgs(phraseItemId(PHRASE), 82.6, LOCAL_DATE);
  assert.deepEqual(args, {
    program: 'pronounce',
    itemId: phraseItemId(PHRASE),
    scoreValue: 83,
    scoreMax: 100,
    scorePct: 83,
    localDate: LOCAL_DATE,
  });
});

test('attempt counter ignores other phrases and blank history', () => {
  assert.equal(countAttempts([], PHRASE), 0);
  assert.equal(countAttempts(undefined, PHRASE), 0);
  assert.equal(
    countAttempts([{ text: 'Hi.' }, { text: PHRASE }, { text: PHRASE }], 'how are you?'),
    2,
  );
});
