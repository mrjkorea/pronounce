// MRJ Pronounce — browser & worker audio pipeline
// - Raw mic constraints (noiseSuppression/echoCancellation/autoGainControl OFF)
// - 2nd-order Butterworth low-pass anti-aliasing filter + 16 kHz resampler
// - Adaptive silence trimming (trimSilence)
// - Near-field gate for noisy classrooms (-12 dB energy + pitch F0 tracking)
// - Zero-mean unit-variance normalization for HuBERT CTC

export const TARGET_SAMPLE_RATE = 16000;
export const NEAR_FIELD_DROP_DB = 12;

export const RAW_MIC_CONSTRAINTS = Object.freeze({
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
});

/**
 * 2nd-order Butterworth low-pass biquad filter (forward-backward zero-phase
 * approximation via two cascades or single biquad pass) to prevent aliasing
 * before downsampling to 16 kHz.
 */
export function lowPassFilter(samples, sampleRate, cutoffHz = 7200) {
  if (!samples || !samples.length || sampleRate <= cutoffHz * 2) {
    return samples ? samples.slice() : new Float32Array(0);
  }
  const n = samples.length;
  const wc = Math.tan((Math.PI * cutoffHz) / sampleRate);
  const k1 = Math.SQRT2 * wc;
  const k2 = wc * wc;
  const a0 = 1 + k1 + k2;
  const b0 = k2 / a0;
  const b1 = (2 * k2) / a0;
  const b2 = b0;
  const a1 = (2 * (k2 - 1)) / a0;
  const a2 = (1 - k1 + k2) / a0;

  const out = new Float32Array(n);
  let x1 = samples[0];
  let x2 = samples[0];
  let y1 = samples[0];
  let y2 = samples[0];
  for (let i = 0; i < n; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/**
 * Resample mono Float32 PCM to targetRate (16 kHz) with anti-aliasing low-pass filter.
 */
export function resampleTo16k(samples, srcRate, targetRate = TARGET_SAMPLE_RATE) {
  if (!samples || !samples.length) return new Float32Array(0);
  if (srcRate === targetRate) return samples.slice();
  const cutoff = Math.min(7400, targetRate * 0.45);
  const filtered = srcRate > targetRate ? lowPassFilter(samples, srcRate, cutoff) : samples;
  const ratio = srcRate / targetRate;
  const outLen = Math.max(1, Math.floor(filtered.length / ratio));
  const out = new Float32Array(outLen);
  const maxIdx = filtered.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = i0 < maxIdx ? i0 + 1 : maxIdx;
    const frac = pos - i0;
    out[i] = filtered[i0] * (1 - frac) + filtered[i1] * frac;
  }
  return out;
}

/**
 * Parse a 16-bit PCM or 32-bit float RIFF WAV buffer directly without AudioContext
 * (works in Web Workers and Node tests as well as main thread).
 */
export function decodeWavBuffer(arrayBuffer, targetRate = TARGET_SAMPLE_RATE) {
  if (!arrayBuffer || arrayBuffer.byteLength < 44) return null;
  const view = new DataView(arrayBuffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== 'RIFF') return null;
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );
  if (wave !== 'WAVE') return null;

  let offset = 12;
  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = targetRate;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataBytes = 0;

  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = Math.max(1, view.getUint16(offset + 10, true));
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataBytes = Math.min(size, view.byteLength - dataOffset);
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (dataOffset < 0 || dataBytes <= 0) return null;

  const bytesPerSample = Math.max(1, bitsPerSample >> 3);
  const frameBytes = bytesPerSample * numChannels;
  const totalFrames = Math.floor(dataBytes / frameBytes);
  const mono = new Float32Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    const base = dataOffset + i * frameBytes;
    for (let c = 0; c < numChannels; c++) {
      const p = base + c * bytesPerSample;
      if (audioFormat === 3 && bitsPerSample === 32) {
        sum += view.getFloat32(p, true);
      } else if (bitsPerSample === 16) {
        sum += view.getInt16(p, true) / 32768;
      } else if (bitsPerSample === 8) {
        sum += (view.getUint8(p) - 128) / 128;
      }
    }
    mono[i] = sum / numChannels;
  }
  return resampleTo16k(mono, sampleRate, targetRate);
}

/**
 * Decode any audio Blob (WAV/WebM/MP4/MP3) -> Float32Array mono at targetRate (16 kHz)
 * with low-pass anti-aliasing filter.
 */
export async function decodeAudioToMono(blob, targetRate = TARGET_SAMPLE_RATE) {
  if (!blob) return new Float32Array(0);
  if (blob instanceof Float32Array) return blob.slice();
  const buf = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : blob;
  const wav = decodeWavBuffer(buf, targetRate);
  if (wav) return wav;

  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) throw new Error('AudioContext unavailable for compressed audio decode');
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const nCh = decoded.numberOfChannels || 1;
    const len = decoded.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < nCh; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += ch[i] / nCh;
    }
    return resampleTo16k(mono, decoded.sampleRate, targetRate);
  } finally {
    if (typeof ctx.close === 'function') ctx.close().catch(() => {});
  }
}

/**
 * Estimate pitch F0 (Hz) on a 20-30 ms frame via normalized autocorrelation.
 * Returns 0 if the frame is unvoiced.
 */
export function estimateFramePitchHz(frame, sampleRate = TARGET_SAMPLE_RATE) {
  const n = frame.length;
  if (n < 64) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;
  let energy0 = 0;
  for (let i = 0; i < n; i++) {
    const d = frame[i] - mean;
    energy0 += d * d;
  }
  if (energy0 < 1e-8) return 0;

  const minLag = Math.max(20, Math.floor(sampleRate / 450)); // 450 Hz max
  const maxLag = Math.min(n - 16, Math.floor(sampleRate / 75)); // 75 Hz min
  let bestCorr = 0;
  let bestLag = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let e1 = 0;
    let e2 = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const a = frame[i] - mean;
      const b = frame[i + lag] - mean;
      cross += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const denom = Math.sqrt(e1 * e2);
    if (denom > 1e-9) {
      const corr = cross / denom;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
  }
  if (bestCorr < 0.35 || bestLag <= 0) return 0;
  return sampleRate / bestLag;
}

/**
 * Trim leading and trailing silence using 20 ms energy windows + adaptive threshold.
 */
export function trimSilence(samples, sampleRate = TARGET_SAMPLE_RATE, threshold = 0.005, padMs = 80) {
  if (!samples || !samples.length) return new Float32Array(0);
  const n = samples.length;
  const win = Math.max(16, Math.floor(sampleRate * 0.02));
  if (n <= win * 2) return samples.slice();

  const nWin = Math.floor(n / win);
  const rmsList = new Float32Array(nWin);
  let maxRms = 0;
  for (let w = 0; w < nWin; w++) {
    let sum = 0;
    const base = w * win;
    for (let j = 0; j < win; j++) {
      const v = samples[base + j];
      sum += v * v;
    }
    const r = Math.sqrt(sum / win);
    rmsList[w] = r;
    if (r > maxRms) maxRms = r;
  }

  // Adaptive threshold: above ambient floor and at least 6% of peak RMS (-24 dB)
  const sorted = Float32Array.from(rmsList).sort();
  const noiseFloor = sorted[Math.floor(nWin * 0.15)] || 0;
  const effThreshold = Math.max(
    threshold,
    Math.min(0.025, noiseFloor * 2.2),
    maxRms * 0.06,
  );

  const pad = Math.floor((sampleRate * padMs) / 1000);
  let startWin = -1;
  let endWin = -1;
  for (let w = 0; w < nWin; w++) {
    if (rmsList[w] >= effThreshold) {
      startWin = w;
      break;
    }
  }
  for (let w = nWin - 1; w >= 0; w--) {
    if (rmsList[w] >= effThreshold) {
      endWin = w;
      break;
    }
  }
  if (startWin < 0 || endWin < startWin) {
    return samples.subarray(0, Math.min(n, win * 4)).slice();
  }
  const start = Math.max(0, startWin * win - pad);
  const end = Math.min(n, (endWin + 1) * win + pad);
  return samples.slice(start, end);
}

/**
 * Near-field gate for noisy classrooms:
 * Drops voiced segments that are much quieter (~12 dB) than the main speaker,
 * or moderately quieter (~9 dB) with a discordant pitch F0 jump from a nearby classmate.
 */
export function applyNearFieldGate(samples, sampleRate = TARGET_SAMPLE_RATE, opts = {}) {
  if (!samples || !samples.length) {
    return { samples: new Float32Array(0), droppedFrames: 0, keptFrames: 0, mainRms: 0, mainF0Hz: 0 };
  }
  const dropDb = typeof opts.dropDb === 'number' ? opts.dropDb : NEAR_FIELD_DROP_DB;
  const linearDropRatio = Math.pow(10, -dropDb / 20); // ~0.2512 for 12 dB
  const pitchAssistRatio = Math.pow(10, -(dropDb - 3) / 20); // ~0.3548 for 9 dB

  const win = Math.max(32, Math.floor(sampleRate * 0.02)); // 20 ms
  const nWin = Math.floor(samples.length / win);
  if (nWin < 3) {
    return { samples: samples.slice(), droppedFrames: 0, keptFrames: nWin, mainRms: 0, mainF0Hz: 0 };
  }

  const frameRms = new Float32Array(nWin);
  const frameF0 = new Float32Array(nWin);
  const activeRms = [];

  for (let w = 0; w < nWin; w++) {
    const start = w * win;
    const sub = samples.subarray(start, start + win);
    let sum = 0;
    for (let i = 0; i < win; i++) sum += sub[i] * sub[i];
    const r = Math.sqrt(sum / win);
    frameRms[w] = r;
    if (r >= 0.003) {
      activeRms.push(r);
      frameF0[w] = estimateFramePitchHz(sub, sampleRate);
    }
  }

  if (!activeRms.length) {
    return { samples: samples.slice(), droppedFrames: 0, keptFrames: 0, mainRms: 0, mainF0Hz: 0 };
  }

  activeRms.sort((a, b) => a - b);
  // Main speaker reference RMS = 85th percentile of active frames
  const mainRms = activeRms[Math.min(activeRms.length - 1, Math.floor(activeRms.length * 0.85))];
  if (mainRms < 0.004) {
    return { samples: samples.slice(), droppedFrames: 0, keptFrames: nWin, mainRms, mainF0Hz: 0 };
  }

  // Estimate main speaker F0 from loudest voiced frames (>= 50% of mainRms)
  const loudPitches = [];
  for (let w = 0; w < nWin; w++) {
    if (frameRms[w] >= mainRms * 0.5 && frameF0[w] > 0) {
      loudPitches.push(frameF0[w]);
    }
  }
  loudPitches.sort((a, b) => a - b);
  const mainF0Hz = loudPitches.length ? loudPitches[Math.floor(loudPitches.length / 2)] : 0;

  // Group contiguous active frames (> 0.003 RMS) into islands, bridging 1-frame (20 ms) micro-gaps
  const isSpeech = new Uint8Array(nWin);
  for (let w = 0; w < nWin; w++) {
    if (frameRms[w] >= 0.003) isSpeech[w] = 1;
  }
  for (let w = 1; w < nWin - 1; w++) {
    if (!isSpeech[w] && isSpeech[w - 1] && isSpeech[w + 1]) isSpeech[w] = 1;
  }

  const out = samples.slice();
  let droppedFrames = 0;
  let keptFrames = 0;

  let w = 0;
  while (w < nWin) {
    if (!isSpeech[w]) {
      w++;
      continue;
    }
    let end = w;
    while (end < nWin && isSpeech[end]) end++;

    // Within an island, split into sub-windows if there is a sharp >12 dB step down/up
    // so background speech right before/after main speech is still gated out.
    for (let k = w; k < end; k++) {
      // Local 60 ms neighborhood peak RMS (preserves quiet consonants attached to a loud vowel)
      let localPeak = frameRms[k];
      for (let d = -2; d <= 2; d++) {
        const idx = k + d;
        if (idx >= w && idx < end && frameRms[idx] > localPeak) {
          localPeak = frameRms[idx];
        }
      }
      // Also compute local 160 ms syllable peak to protect unvoiced stop closures
      let syllablePeak = localPeak;
      for (let d = -8; d <= 8; d++) {
        const idx = k + d;
        if (idx >= w && idx < end && frameRms[idx] > syllablePeak) {
          syllablePeak = frameRms[idx];
        }
      }
      const f0 = frameF0[k];
      const voiced = f0 > 0;
      const pitchOctaves = voiced && mainF0Hz > 0 ? Math.abs(Math.log2(f0 / mainF0Hz)) : 0;

      // Requirement 8: Drop voiced segments much quieter (about 12 dB) than the main speaker,
      // using energy plus pitch. Also drop sustained (>160 ms) unvoiced noise >=14 dB below main speaker.
      const voicedTooQuiet12dB = voiced && localPeak < mainRms * linearDropRatio;
      const unvoicedSustainedQuiet = !voiced && syllablePeak < mainRms * (linearDropRatio * 0.8);
      const pitchMismatchQuiet =
        voiced &&
        localPeak < mainRms * pitchAssistRatio &&
        pitchOctaves > 0.35;

      if (voicedTooQuiet12dB || unvoicedSustainedQuiet || pitchMismatchQuiet) {
        droppedFrames++;
        const s0 = k * win;
        const s1 = s0 + win;
        for (let i = s0; i < s1; i++) out[i] = 0;
      } else {
        keptFrames++;
      }
    }
    w = end;
  }

  return {
    samples: out,
    droppedFrames,
    keptFrames,
    mainRms,
    mainF0Hz,
  };
}

/**
 * Compute audio quality & spectral clarity statistics.
 * Detects silence, clipping, SNR, and muffled/mumbled low-pass speech.
 */
export function audioStats(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const n = samples ? samples.length : 0;
  if (!n) {
    return {
      durationMs: 0,
      voicedDurationMs: 0,
      rms: 0,
      tooQuiet: true,
      mumbled: true,
      highBandRatio: 0,
      clipping: false,
      snrEst: null,
    };
  }
  let sum = 0;
  let diffSum = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i];
    sum += x * x;
    if (i > 0) {
      const d = x - samples[i - 1];
      diffSum += d * d;
    }
    const a = Math.abs(x);
    if (a > maxAbs) maxAbs = a;
  }
  const rms = Math.sqrt(sum / n);
  const durationMs = (n / sampleRate) * 1000;
  const highBandRatio = sum > 1e-9 ? diffSum / sum : 0;

  const win = Math.max(1, Math.floor(sampleRate * 0.02));
  const windows = [];
  let voicedWins = 0;
  for (let i = 0; i + win <= n; i += win) {
    let wsum = 0;
    for (let j = i; j < i + win; j++) wsum += samples[j] * samples[j];
    const wrms = Math.sqrt(wsum / win);
    windows.push(wrms);
    if (wrms >= 0.005) voicedWins++;
  }
  const voicedDurationMs = voicedWins * 20;
  windows.sort((a, b) => a - b);
  const noise = windows.length ? windows[Math.floor(windows.length * 0.1)] || 1e-6 : 1e-6;
  const peakWin = windows.length ? windows[windows.length - 1] : rms;
  const snrEst = 20 * Math.log10((peakWin + 1e-6) / (noise + 1e-6));

  const tooQuiet = rms < 0.005 || peakWin < 0.012 || voicedDurationMs < 100;
  // Clear speech has consonant/formant energy above 500 Hz (highBandRatio >= 0.014).
  // Mumbled/low-passed speech (< 450 Hz) has highBandRatio <= 0.013.
  const mumbled = !tooQuiet && highBandRatio < 0.014;
  const clipping = maxAbs > 0.98;

  return {
    durationMs,
    voicedDurationMs,
    rms,
    tooQuiet,
    mumbled,
    highBandRatio,
    clipping,
    snrEst,
  };
}

/**
 * Full pre-model audio conditioning pipeline:
 * 1. Near-field gate (-12 dB + F0 pitch) to drop background classmates
 * 2. Silence trimming before and after speech
 * 3. Cap speech window to maxMs
 * 4. Compute VAD + spectral clarity stats
 */
export function prepareSpeechSamples(samples, sampleRate = TARGET_SAMPLE_RATE, opts = {}) {
  if (!samples || !samples.length) {
    return {
      trimmed: new Float32Array(0),
      normalized: new Float32Array(0),
      stats: audioStats(new Float32Array(0), sampleRate),
      nearField: { droppedFrames: 0, keptFrames: 0, mainRms: 0, mainF0Hz: 0 },
    };
  }
  const rs = sampleRate === TARGET_SAMPLE_RATE
    ? samples
    : resampleTo16k(samples, sampleRate, TARGET_SAMPLE_RATE);

  const initialTrim = trimSilence(rs, TARGET_SAMPLE_RATE, 0.004, 80);
  const nearField = applyNearFieldGate(initialTrim, TARGET_SAMPLE_RATE, opts);
  const reTrimmed = trimSilence(nearField.samples, TARGET_SAMPLE_RATE, 0.004, 80);
  const capped = capSpeechWindow(reTrimmed, TARGET_SAMPLE_RATE, opts.maxMs || 6500);
  const stats = audioStats(capped, TARGET_SAMPLE_RATE);
  const normalized = normalizeForModel(capped);

  return {
    trimmed: capped,
    normalized,
    stats,
    nearField: {
      droppedFrames: nearField.droppedFrames,
      keptFrames: nearField.keptFrames,
      mainRms: nearField.mainRms,
      mainF0Hz: nearField.mainF0Hz,
    },
  };
}

/**
 * Normalize for HuBERT / wav2vec2 (do_normalize=true -> zero-mean unit-variance)
 */
export function normalizeForModel(samples) {
  const n = samples ? samples.length : 0;
  if (!n) return new Float32Array(0);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = samples[i] - mean;
    varSum += d * d;
  }
  if (!(varSum > 0)) return samples.slice();
  const scale = Math.sqrt(varSum / n) || 1e-6;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (samples[i] - mean) / scale;
  return out;
}

/**
 * Keep at most maxMs of the highest-energy speech window.
 */
export function capSpeechWindow(samples, sampleRate = TARGET_SAMPLE_RATE, maxMs = 6500) {
  const maxN = Math.floor((sampleRate * maxMs) / 1000);
  if (!samples || samples.length <= maxN) return samples;
  const hop = Math.max(16, Math.floor(sampleRate * 0.02));
  const nWin = Math.floor(samples.length / hop);
  if (nWin < 2) return samples.subarray(0, maxN);
  const energy = new Float64Array(nWin);
  for (let i = 0; i < nWin; i++) {
    let s = 0;
    const a = i * hop;
    const b = Math.min(samples.length, a + hop);
    for (let j = a; j < b; j++) s += samples[j] * samples[j];
    energy[i] = s;
  }
  const need = Math.max(1, Math.floor(maxN / hop));
  let best = -1;
  let bestI = 0;
  let acc = 0;
  for (let i = 0; i < nWin; i++) {
    acc += energy[i];
    if (i >= need) acc -= energy[i - need];
    if (i >= need - 1 && acc > best) {
      best = acc;
      bestI = i - need + 1;
    }
  }
  const start = bestI * hop;
  return samples.subarray(start, Math.min(samples.length, start + maxN));
}

/**
 * PCM float -> 16-bit mono WAV Blob
 */
export function floatToWavBlob(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const n = samples ? samples.length : 0;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ascii = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    o += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}
