import test from 'node:test';
import assert from 'node:assert/strict';
import { createPackSaveScheduler } from '../src/pack-save-scheduler.js';
import {
  buildPackSavePayload,
  scoresNeedSaveAfterSync,
  shouldFlushPackOnPagehide,
} from '../src/progress-merge.js';

function makeScheduler(overrides = {}) {
  let packLoadOk = overrides.packLoadOk !== false;
  let serverScores = overrides.serverScores || {};
  let localScores = overrides.localScores || {};
  let authReady = overrides.authReady !== false;
  const saves = [];
  let loadCalls = 0;

  const timers = [];
  const scheduler = createPackSaveScheduler({
    minIntervalMs: 100,
    getPackLoadOk: () => packLoadOk,
    setPackLoadOk: (ok) => { packLoadOk = ok; },
    isAuthReady: () => authReady,
    readLocalScores: () => localScores,
    getLoadedServerScores: () => serverScores,
    setLoadedServerScores: (scores) => { serverScores = scores; },
    savePack: async (json) => {
      saves.push(json);
      if (overrides.savePack) return overrides.savePack(json, saves);
      return { ok: true };
    },
    ensurePackLoaded: overrides.ensurePackLoaded || (async () => {
      loadCalls += 1;
      packLoadOk = true;
      authReady = true;
      return true;
    }),
    buildPackSavePayload,
    scoresNeedSaveAfterSync,
    shouldFlushPackOnPagehide,
    now: overrides.now || (() => Date.now()),
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms);
      timers.push(id);
      return id;
    },
    clearTimerFn: (id) => clearTimeout(id),
  });

  return {
    scheduler,
    saves,
    getLoadCalls: () => loadCalls,
    setLocal: (scores) => { localScores = scores; },
    setPackLoadOk: (ok) => { packLoadOk = ok; },
    setAuthReady: (ok) => { authReady = ok; },
    clearTimers: () => {
      for (const id of timers) clearTimeout(id);
      timers.length = 0;
    },
  };
}

test('markDirty schedules savePack when pack load succeeded', async () => {
  const ctx = makeScheduler({
    localScores: { line_a: { scorePct: 80, score: 0.8, pass: true, at: 1 } },
  });
  ctx.scheduler.markDirty();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctx.saves.length, 1);
  const payload = JSON.parse(ctx.saves[0]);
  assert.equal(payload.line_a.scorePct, 80);
  ctx.clearTimers();
});

test('score during in-flight save still triggers a follow-up save', async () => {
  let resolveSave;
  const ctx = makeScheduler({
    localScores: { a: { scorePct: 50, score: 0.5, pass: false, at: 1 } },
    savePack: () => new Promise((resolve) => {
      resolveSave = () => resolve({ ok: true });
    }),
  });
  ctx.scheduler.setLastSaveAt(0);
  ctx.scheduler.markDirty();
  await new Promise((r) => setTimeout(r, 0));
  ctx.setLocal({
    a: { scorePct: 50, score: 0.5, pass: false, at: 1 },
    b: { scorePct: 70, score: 0.7, pass: true, at: 2 },
  });
  ctx.scheduler.markDirty();
  resolveSave();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ctx.saves.length, 2);
  const second = JSON.parse(ctx.saves[1]);
  assert.equal(second.b.scorePct, 70);
  ctx.clearTimers();
});

test('dirty while pack load failed retries ensurePackLoaded', async () => {
  const ctx = makeScheduler({ packLoadOk: false });
  ctx.scheduler.markDirty();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctx.getLoadCalls(), 1);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctx.saves.length, 1);
  ctx.clearTimers();
});

test('save failure with pack_not_loaded re-enables load and keeps dirty', async () => {
  let attempt = 0;
  const ctx = makeScheduler({
    savePack: async () => {
      attempt += 1;
      if (attempt === 1) {
        ctx.setPackLoadOk(false);
        ctx.setAuthReady(false);
        return { ok: false, error: 'pack_not_loaded' };
      }
      return { ok: true };
    },
  });
  ctx.scheduler.setLastSaveAt(0);
  ctx.scheduler.markDirty();
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(ctx.getLoadCalls() >= 1);
  assert.ok(ctx.saves.length >= 1);
  ctx.clearTimers();
});
