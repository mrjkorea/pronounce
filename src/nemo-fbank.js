// 80-dim log-mel features.
// Citrinet uses the sherpa-onnx NeMo CTC settings (librosa/Slaney mel, Hann, no DC).
// ZIPA uses the lhotse/Kaldi fbank settings from the ZIPA ONNX inference script.

const F32_EPS = 1.1920928955078125e-7;

function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * wRe - im[i + k + half] * wIm;
        const vIm = re[i + k + half] * wIm + im[i + k + half] * wRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nRe;
      }
    }
  }
}

function reflectIndex(s, waveDim) {
  while (s < 0 || s >= waveDim) {
    if (s < 0) s = -s - 1;
    else s = 2 * waveDim - 1 - s;
  }
  return s;
}

function melScaleHtk(freq) {
  return 1127 * Math.log(1 + freq / 700);
}

function melScaleSlaney(freq) {
  if (freq <= 1000) return freq * 3 / 200;
  return 15 + 14.545078505785561 * Math.log(freq / 1000);
}

function invMelSlaney(mel) {
  if (mel <= 15) return 200 / 3 * mel;
  return 1000 * Math.exp((mel - 15) * 0.06875177742094911);
}

function buildBanks(kind) {
  const sr = 16000;
  const nFft = 512;
  const numBins = 80;
  const fftBinWidth = sr / nFft;
  const nyquist = sr / 2;
  const librosa = kind === 'nemo';
  const low = librosa ? 0 : 20;
  const high = librosa ? nyquist : nyquist - 400;
  const nFreq = librosa ? (nFft / 2 + 1) : (nFft / 2);
  const melLow = librosa ? melScaleSlaney(low) : melScaleHtk(low);
  const melHigh = librosa ? melScaleSlaney(high) : melScaleHtk(high);
  const delta = (melHigh - melLow) / (numBins + 1);
  const banks = [];
  for (let bin = 0; bin < numBins; bin++) {
    const leftM = melLow + bin * delta;
    const centerM = melLow + (bin + 1) * delta;
    const rightM = melLow + (bin + 2) * delta;
    let left;
    let center;
    let right;
    if (librosa) {
      left = invMelSlaney(leftM);
      center = invMelSlaney(centerM);
      right = invMelSlaney(rightM);
    } else {
      left = 700 * (Math.exp(leftM / 1127) - 1);
      center = 700 * (Math.exp(centerM / 1127) - 1);
      right = 700 * (Math.exp(rightM / 1127) - 1);
    }
    const weights = new Float32Array(nFreq);
    const limit = librosa ? nFreq : nFreq;
    for (let i = 0; i < limit; i++) {
      const hz = fftBinWidth * i;
      const aboveLeft = librosa ? hz > left : melScaleHtk(hz) > leftM;
      const belowRight = librosa ? hz < right : melScaleHtk(hz) < rightM;
      if (!aboveLeft || !belowRight) continue;
      let weight;
      if (librosa) {
        weight = hz <= center ? (hz - left) / (center - left) : (right - hz) / (right - center);
        weight *= 2 / (right - left);
      } else {
        const mel = melScaleHtk(hz);
        weight = mel <= centerM ? (mel - leftM) / (centerM - leftM) : (rightM - mel) / (rightM - centerM);
      }
      weights[i] = weight;
    }
    banks.push(weights);
  }
  return banks;
}

let nemoBanks = null;
let zipaBanks = null;
let hann = null;
let povey = null;

function hannWindow() {
  if (hann) return hann;
  const n = 400;
  hann = new Float32Array(n);
  const a = 2 * Math.PI / n;
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos(a * i);
  return hann;
}

function poveyWindow() {
  if (povey) return povey;
  const n = 400;
  povey = new Float32Array(n);
  const a = 2 * Math.PI / (n - 1);
  for (let i = 0; i < n; i++) povey[i] = Math.pow(0.5 - 0.5 * Math.cos(a * i), 0.85);
  return povey;
}

function logMelFrames(samples, kind) {
  const frameLength = 400;
  const frameShift = 160;
  const nFft = 512;
  const n = samples.length;
  if (!n) return [];
  const numFrames = Math.floor((n + (frameShift / 2)) / frameShift) || 1;
  const banks = kind === 'nemo' ? (nemoBanks || (nemoBanks = buildBanks('nemo'))) : (zipaBanks || (zipaBanks = buildBanks('zipa')));
  const window = kind === 'nemo' ? hannWindow() : poveyWindow();
  const preemph = 0.97;
  const removeDc = kind !== 'nemo';
  const nFreq = banks[0].length;
  const frames = [];
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  for (let f = 0; f < numFrames; f++) {
    const start = frameShift * f + Math.floor(frameShift / 2) - Math.floor(frameLength / 2);
    re.fill(0);
    im.fill(0);
    for (let s = 0; s < frameLength; s++) re[s] = samples[reflectIndex(start + s, n)];
    if (removeDc) {
      let mean = 0;
      for (let s = 0; s < frameLength; s++) mean += re[s];
      mean /= frameLength;
      for (let s = 0; s < frameLength; s++) re[s] -= mean;
    }
    for (let s = frameLength - 1; s > 0; s--) re[s] -= preemph * re[s - 1];
    re[0] -= preemph * re[0];
    for (let s = 0; s < frameLength; s++) re[s] *= window[s];
    fftRadix2(re, im);
    const power = new Float32Array(nFreq);
    for (let i = 0; i < nFreq; i++) power[i] = re[i] * re[i] + im[i] * im[i];
    const mel = new Float32Array(80);
    for (let b = 0; b < 80; b++) {
      const w = banks[b];
      let energy = 0;
      for (let i = 0; i < nFreq; i++) energy += w[i] * power[i];
      if (energy < F32_EPS) energy = F32_EPS;
      mel[b] = Math.log(energy);
    }
    frames.push(mel);
  }
  return frames;
}

function normalizePerFeature(frames) {
  const t = frames.length;
  if (!t) return frames;
  const mean = new Float64Array(80);
  for (let i = 0; i < t; i++) {
    const row = frames[i];
    for (let c = 0; c < 80; c++) mean[c] += row[c];
  }
  for (let c = 0; c < 80; c++) mean[c] /= t;
  const varc = new Float64Array(80);
  for (let i = 0; i < t; i++) {
    const row = frames[i];
    for (let c = 0; c < 80; c++) {
      const d = row[c] - mean[c];
      varc[c] += d * d;
    }
  }
  const inv = new Float64Array(80);
  for (let c = 0; c < 80; c++) inv[c] = 1 / (Math.sqrt(varc[c] / t) + 1e-5);
  for (let i = 0; i < t; i++) {
    const row = frames[i];
    for (let c = 0; c < 80; c++) row[c] = (row[c] - mean[c]) * inv[c];
  }
  return frames;
}

/** NeMo Citrinet features, shape [T, 80], per-feature normalized. */
export function citrinetFeatures(samples) {
  return normalizePerFeature(logMelFrames(samples, 'nemo'));
}

/** ZIPA / lhotse fbank, shape [T, 80], not per-feature normalized. */
export function zipaFeatures(samples) {
  return logMelFrames(samples, 'zipa');
}

/** Pack [T, 80] frames into a channel-first [1, 80, T] buffer. */
export function framesAsChannelsFirst(frames) {
  const t = frames.length;
  const out = new Float32Array(80 * t);
  for (let i = 0; i < t; i++) {
    const row = frames[i];
    for (let c = 0; c < 80; c++) out[c * t + i] = row[c];
  }
  return out;
}

/** Pack [T, 80] frames into a time-major [1, T, 80] buffer. */
export function framesAsTimeMajor(frames) {
  const t = frames.length;
  const out = new Float32Array(t * 80);
  for (let i = 0; i < t; i++) out.set(frames[i], i * 80);
  return out;
}
