// Shared MRJ pronunciation checker (HuBERT phoneme engine, ron-jo/hubert-base-phoneme-en-onnx int8).
// Other MRJ apps import this file from https://mrjkorea.github.io/pronounce/src/shared.js so the
// ~116 MB model (models/hubert/manifest.json + part-00..02.bin) is downloaded and cached once per browser.
// Download progress reports MB done/total; stalled Wi‑Fi fails after 45s with a retry-friendly message.
// Failed boot clears bootP so callers can call bootShared() again.
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
import { APP_THRESHOLDS, PASS_PCT, getAppThresholds, bandForScore } from './engine.js';
import * as audio from './audio.js';

export const PRONOUNCE_BASE = new URL('../', import.meta.url).href;
export const HUBERT_MANIFEST_URL = PRONOUNCE_BASE + 'models/hubert/manifest.json';
export { APP_THRESHOLDS, PASS_PCT, getAppThresholds, bandForScore, gradeTrialSamples, gradeAudioForApp, checkModelCached, DOOR_FAIL_TEXT, audio };

let bootP = null;

/**
 * bootShared(opts) — start (or join) the shared HuBERT checker boot.
 *
 * Default: waits for G2P + ~116 MB HuBERT + worker (same as Pronounce Day 4). Pass `onProgress(frac, label)`.
 *
 * lazy: true | deferModel: true — resolves after small G2P assets only; HuBERT downloads in the background so
 * embed UIs (Culture Speak, etc.) can paint immediately. Use onProgress for the download bar; call ensureModel()
 * or grade() before the first score. getModelBootState() → idle | loading | ready | failed.
 *
 * downloadStallMs (or stallMs) — classroom Wi‑Fi stall guard (default 45s; same as MODEL_DOWNLOAD_STALL_MS).
 *
 * On boot failure, the internal promise is cleared so a later bootShared() call can retry.
 */
export function bootShared(opts = {}) {
  const stallMs =
    typeof opts.downloadStallMs === 'number'
      ? opts.downloadStallMs
      : typeof opts.stallMs === 'number'
        ? opts.stallMs
        : undefined;
  const merged = { ...opts, baseUrl: PRONOUNCE_BASE, ...(stallMs !== undefined ? { stallMs } : {}) };
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

/** Wait until HuBERT is ready to grade (no-op if already ready). Rejects on download/init failure. */
export function ensureModel(opts = {}) {
  return ensureTrialModel({ ...opts, baseUrl: PRONOUNCE_BASE });
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
