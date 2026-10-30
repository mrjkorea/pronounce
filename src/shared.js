// Shared MRJ pronunciation checker (HuBERT phoneme engine, ron-jo/hubert-base-phoneme-en-onnx int8).
// Other MRJ apps import this file from https://mrjkorea.github.io/pronounce/src/shared.js so the
// ~116 MB model (models/hubert/manifest.json + part-00..02.bin) is downloaded and cached once per browser.
// Download progress reports MB done/total; stalled Wi‑Fi fails after SHARED_DOWNLOAD_STALL_MS (20s) with a retry-friendly message.
// Failed boot clears bootP so callers can call bootShared() again.
// bootSharedForUi() fail-opens practice / Day 4: lazy HuBERT + ~10s paint cap (hear-only until ensureModel()).
// Scoring for every app: green 75+, yellow 50-74, red under 50. PASS = line average >= 60.
import {
  bootTrialInPage,
  gradeTrialSamples,
  gradeAudioForApp,
  checkModelCached,
  DOOR_FAIL_TEXT,
  exposeGlobalPronounceApi,
  ensureTrialModel,
  getTrialBootState,
  trialRuntime,
  resetTrialBoot,
} from './trial.js';
import { APP_THRESHOLDS, PASS_PCT, getAppThresholds, bandForScore } from './engine.js?v=20261030-day4-mic-score';
import * as audio from './audio.js?v=20261030-day4-mic-score';

export const PRONOUNCE_BASE = new URL('../', import.meta.url).href;
export const HUBERT_MANIFEST_URL = PRONOUNCE_BASE + 'models/hubert/manifest.json';
/** Classroom Wi‑Fi: fail a stuck HuBERT part download after this idle gap (overrides trial 45s default when bootShared runs). */
export const SHARED_DOWNLOAD_STALL_MS = 20000;
/** Max wait before UI must leave Loading (hear-only / basic mode; model continues in background). */
export const SHARED_BOOT_UI_TIMEOUT_MS = 10000;
export { APP_THRESHOLDS, PASS_PCT, getAppThresholds, bandForScore, gradeTrialSamples, gradeAudioForApp, checkModelCached, DOOR_FAIL_TEXT, audio };

let bootP = null;

function mergeBootOpts(opts = {}) {
  const stallMs =
    typeof opts.downloadStallMs === 'number'
      ? opts.downloadStallMs
      : typeof opts.stallMs === 'number'
        ? opts.stallMs
        : SHARED_DOWNLOAD_STALL_MS;
  return {
    ...opts,
    baseUrl: PRONOUNCE_BASE,
    stallMs,
    downloadStallMs: stallMs,
  };
}

/**
 * bootShared(opts) — start (or join) the shared HuBERT checker boot.
 *
 * Default: waits for G2P + ~116 MB HuBERT + worker (same as Pronounce Day 4). Pass `onProgress(frac, label)`.
 *
 * lazy: true | deferModel: true — resolves after small G2P assets only; HuBERT downloads in the background so
 * embed UIs (Culture Speak, etc.) can paint immediately. Use onProgress for the download bar; call ensureModel()
 * or grade() before the first score. getModelBootState() → idle | loading | ready | failed.
 *
 * downloadStallMs (or stallMs) — classroom Wi‑Fi stall guard (default SHARED_DOWNLOAD_STALL_MS / 20s).
 *
 * On boot failure, the internal promise is cleared so a later bootShared() call can retry.
 */
export function bootShared(opts = {}) {
  const merged = mergeBootOpts(opts);
  if (!bootP) {
    bootP = bootTrialInPage(merged).then((r) => {
      exposeGlobalPronounceApi();
      if (r && r.lazy) {
        ensureTrialModel(merged).catch(() => {
          bootP = null;
        });
      }
      return r;
    });
    bootP.catch(() => {
      bootP = null;
    });
  }
  return bootP;
}

/**
 * Fail-open boot for Pronounce practice and Day 4: lazy-load HuBERT, resolve within bootTimeoutMs so UI paints.
 * Listen / navigation work immediately; call ensureModel() (or grade()) before mic scoring.
 */
export async function bootSharedForUi(opts = {}) {
  const bootTimeoutMs =
    typeof opts.bootTimeoutMs === 'number'
      ? opts.bootTimeoutMs
      : typeof opts.uiTimeoutMs === 'number'
        ? opts.uiTimeoutMs
        : SHARED_BOOT_UI_TIMEOUT_MS;
  const merged = mergeBootOpts({ lazy: true, deferModel: true, ...opts });
  const boot = bootShared(merged);
  const opened = await Promise.race([
    boot.then(() => 'boot'),
    new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), bootTimeoutMs);
    }),
  ]);
  return {
    timedOut: opened === 'timeout',
    getState: getModelBootState,
    ensureModel: () => ensureModel(merged),
    retryModel: async () => {
      resetSharedBoot();
      await bootShared(merged);
      return ensureModel(merged);
    },
  };
}

/** Wait until HuBERT is ready to grade (no-op if already ready). Rejects on download/init failure. */
export function ensureModel(opts = {}) {
  return ensureTrialModel(mergeBootOpts(opts));
}

/** idle | loading | ready | failed — for embed status chrome while lazy-loading. */
export function getModelBootState() {
  return getTrialBootState();
}

/** Clear failed lazy boot so bootShared() can be called again (no-op if loading or ready). */
export function resetSharedBoot() {
  if (trialRuntime().ready || getTrialBootState() === 'loading') return false;
  bootP = null;
  resetTrialBoot();
  return true;
}

/** Grade a Blob or 16 kHz Float32Array. appId: day4 | day6 | phonics | decodables | toeic. */
export async function grade(audioIn, targetText, appId = 'default', opts = {}) {
  await ensureModel();
  const out = await gradeAudioForApp(audioIn, targetText, { ...opts, appId, passAt: PASS_PCT });
  return out;
}
