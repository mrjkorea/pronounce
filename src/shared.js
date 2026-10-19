// Shared MRJ pronunciation checker (HuBERT phoneme engine, ron-jo/hubert-base-phoneme-en-onnx int8).
// Other MRJ apps import this file from https://mrjkorea.github.io/pronounce/src/shared.js so the
// ~116 MB model (models/hubert/manifest.json + part-00..02.bin) is downloaded and cached once per browser.
// Scoring for every app: green 75+, yellow 50-74, red under 50. PASS = line average >= 60.
import { bootTrialInPage, gradeTrialSamples, gradeAudioForApp, checkModelCached, DOOR_FAIL_TEXT, exposeGlobalPronounceApi } from './trial.js';
import { APP_THRESHOLDS, PASS_PCT, getAppThresholds, bandForScore } from './engine.js';
import * as audio from './audio.js';

export const PRONOUNCE_BASE = new URL('../', import.meta.url).href;
export const HUBERT_MANIFEST_URL = PRONOUNCE_BASE + 'models/hubert/manifest.json';
export { APP_THRESHOLDS, PASS_PCT, getAppThresholds, bandForScore, gradeTrialSamples, gradeAudioForApp, checkModelCached, DOOR_FAIL_TEXT, audio };

let bootP = null;
export function bootShared(opts = {}) {
  if (!bootP) {
    bootP = bootTrialInPage({ ...opts, baseUrl: PRONOUNCE_BASE }).then((r) => { exposeGlobalPronounceApi(); return r; });
    bootP.catch(() => { bootP = null; });
  }
  return bootP;
}

/** Grade a Blob or 16 kHz Float32Array. appId: day4 | day6 | phonics | decodables | toeic. */
export async function grade(audioIn, targetText, appId = 'default', opts = {}) {
  await bootShared();
  const out = await gradeAudioForApp(audioIn, targetText, { ...opts, appId, passAt: PASS_PCT });
  return out;
}
