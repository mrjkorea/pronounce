import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import {
  reportScoredActivity,
  buildNoteScoreArgs,
} from '../src/score-reporting.js';

const TEST_STUDENT = 'zz_test_mrjmetrics';
const ITEM = 'basic_b__unit01__06';
const META = { bookId: 'basic_b', unitId: 'unit01' };
const LOCAL_DATE = '2026-10-11';

function mockAuth(noteScoreImpl) {
  const calls = [];
  return {
    student: () => TEST_STUDENT,
    noteScore: (args) => {
      calls.push(args);
      if (noteScoreImpl) noteScoreImpl(args);
    },
    noteScoreCalls: calls,
  };
}

function mockMrjScores() {
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

test('thrown grade: no noteScore and one CM attempt_error without score_value', () => {
  const auth = mockAuth();
  const mrjScores = mockMrjScores();
  const record = { scorePct: 0, pass: false, english: 'hi', weak: [] };
  const thrown = Object.assign(new Error('too short'), { code: 'too_short' });

  const out = reportScoredActivity({
    itemId: ITEM,
    record,
    thrown,
    meta: META,
    auth,
    mrjScores,
    localDateFn: () => LOCAL_DATE,
  });

  assert.equal(out.noteScoreCalls, 0);
  assert.equal(auth.noteScoreCalls.length, 0);
  assert.equal(mrjScores.posts.length, 1);
  const cm = mrjScores.posts[0];
  assert.equal(cm.itemId, `pronounce:${ITEM}`);
  assert.equal(cm.itemType, 'attempt_error');
  assert.equal(cm.bookTitle, 'basic_b');
  assert.equal(cm.unitTitle, 'unit01');
  assert.equal(cm.metadata.reason, 'too_short');
  assert.equal(cm.scoreValue, undefined);
  assert.equal(cm.scoreMax, undefined);
});

test('graded 73: noteScore and CM share pronounce-prefixed itemId and scores', () => {
  const auth = mockAuth();
  const mrjScores = mockMrjScores();
  const record = {
    scorePct: 73,
    pass: true,
    english: 'Hello',
    weak: [],
  };

  const out = reportScoredActivity({
    itemId: ITEM,
    record,
    thrown: null,
    meta: META,
    auth,
    mrjScores,
    localDateFn: () => LOCAL_DATE,
  });

  assert.equal(out.noteScoreCalls, 1);
  assert.deepEqual(auth.noteScoreCalls[0], {
    program: 'pronounce',
    itemId: `pronounce:${ITEM}`,
    scoreValue: 73,
    scoreMax: 100,
    scorePct: 73,
    localDate: LOCAL_DATE,
  });
  assert.equal(mrjScores.posts.length, 1);
  const cm = mrjScores.posts[0];
  assert.equal(cm.itemId, `pronounce:${ITEM}`);
  assert.equal(cm.scoreValue, 73);
  assert.equal(cm.scoreMax, 100);
  assert.equal(cm.scorePct, 73);
  assert.equal(cm.itemType, 'pronunciation');
});

test('buildNoteScoreArgs rounds scorePct', () => {
  assert.deepEqual(
    buildNoteScoreArgs(ITEM, 72.6, LOCAL_DATE).scoreValue,
    73,
  );
});

test('index.html cache-bust ?v= values match mrj-build meta', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(root, '..', 'index.html'), 'utf8');
  const buildMatch = html.match(/name="mrj-build"\s+content="([^"]+)"/);
  assert.ok(buildMatch, 'mrj-build meta');
  const build = buildMatch[1];
  const vRefs = [...html.matchAll(/\?v=([^"']+)/g)].map((m) => m[1]);
  assert.ok(vRefs.length >= 2, 'expected ?v= on assets');
  for (const v of vRefs) {
    assert.equal(v, build, `?v=${v} should match build ${build}`);
  }
});

test('flow.js does not ship a client teacher password', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const flowSrc = readFileSync(join(root, '..', 'src', 'flow.js'), 'utf8');
  assert.doesNotMatch(flowSrc, /TEACHER_PASSWORD/);
  assert.doesNotMatch(flowSrc, /tryTeacherPassword/);
});

test('index.html uses mrj-auth chip Teacher control only', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(root, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /pronounceTeacherBtn/);
  assert.match(html, /mrj-auth-boot\.js/);
});

test('mrj-scores post uses signed-in student id_key, not unknown (mocked fetch)', async () => {
  const fetches = [];
  const root = {
    fetch: (url, init) => {
      fetches.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });
    },
    localStorage: {
      getItem: () => '[]',
      setItem: () => {},
    },
    MRJ_AUTH: {
      student: () => TEST_STUDENT,
    },
    addEventListener: () => {},
  };
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'mrj-scores.js'), 'utf8');
  vm.runInNewContext(code, root, { filename: 'mrj-scores.js' });

  await root.MRJ_SCORES.post({
    program: 'pronounce',
    itemId: `pronounce:${ITEM}`,
    itemType: 'pronunciation',
    scoreValue: 50,
    scoreMax: 100,
    scorePct: 50,
  });

  assert.equal(fetches.length, 1);
  const body = fetches[0].body;
  assert.equal(body.student_email, TEST_STUDENT);
  assert.equal(body.student_name, TEST_STUDENT);
  assert.match(body.session_id, /^pronounce-zz_test_mrjmetrics-/);
  const ev = body.events[0];
  assert.equal(ev.identity_method, 'mrj_signin');
  assert.equal(ev.local_date, root.MRJ_SCORES.localDate());
});

test('mrj-scores post skips network when no student', async () => {
  const fetches = [];
  const root = {
    fetch: () => {
      fetches.push(1);
      return Promise.resolve({ ok: true, json: () => ({}) });
    },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    addEventListener: () => {},
  };
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'mrj-scores.js'), 'utf8');
  vm.runInNewContext(code, root, { filename: 'mrj-scores.js' });

  const res = await root.MRJ_SCORES.post({ program: 'pronounce', itemId: 'x' });
  assert.equal(res.status, 'skipped');
  assert.equal(fetches.length, 0);
});
