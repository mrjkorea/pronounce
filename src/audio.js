// MRJ Pronounce — audio helpers (browser)

// Decode any audio blob (webm/mp4/wav) → Float32Array mono at target rate
async function decodeAudioToMono(blob, targetRate = 16000) {
  const buf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    const ch0 = decoded.getChannelData(0);
    const srcRate = decoded.sampleRate;
    // resample to targetRate (linear)
    if (srcRate === targetRate) return ch0.slice();
    const ratio = srcRate / targetRate;
    const outLen = Math.floor(ch0.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, ch0.length - 1);
      const frac = pos - i0;
      out[i] = ch0[i0] * (1 - frac) + ch0[i1] * frac;
    }
    return out;
  } finally {
    if (typeof ctx.close === 'function') ctx.close().catch(() => {});
  }
}

// match python audio.py gates (approx)
function audioStats(samples, sampleRate) {
  const n = samples.length;
  if (!n) return { durationMs: 0, rms: 0, tooQuiet: true, clipping: false, snrEst: null };
  let sum = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) { sum += samples[i] * samples[i]; const a = Math.abs(samples[i]); if (a > maxAbs) maxAbs = a; }
  const rms = Math.sqrt(sum / n);
  const durationMs = (n / sampleRate) * 1000;
  const tooQuiet = rms < 0.005; // python gate ~ quiet
  const clipping = maxAbs > 0.98;
  // crude SNR: noise floor from lowest 10% RMS windows
  let snrEst = null;
  try {
    const win = Math.max(1, Math.floor(sampleRate * 0.02));
    const windows = [];
    for (let i = 0; i + win <= n; i += win) {
      let wsum = 0;
      for (let j = i; j < i + win; j++) wsum += samples[j] * samples[j];
      windows.push(Math.sqrt(wsum / win));
    }
    windows.sort((a, b) => a - b);
    const noise = windows[Math.floor(windows.length * 0.1)] || 1e-6;
    snrEst = 20 * Math.log10((rms + 1e-6) / (noise + 1e-6));
  } catch (_) { /* ignore */ }
  return { durationMs, rms, tooQuiet, clipping, snrEst };
}

// normalize for wav2vec2 (do_normalize=true → zero-mean unit-var)
function normalizeForModel(samples) {
  const n = samples.length;
  if (!n) return new Float32Array(0);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  let varSum = 0;
  for (let i = 0; i < n; i++) { const d = samples[i] - mean; varSum += d * d; }
  if (!(varSum > 0)) return samples.slice();
  const scale = Math.sqrt(varSum / n) || 1e-6;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (samples[i] - mean) / scale;
  return out;
}

// Trim leading/trailing silence — keeps the model input short (≈3× faster
// grading on phones: the recorder already leaves ~1.6s grace + 0.9s tail).
// Returns a copy trimmed to first/last RMS > threshold with small padding.
function trimSilence(samples, sampleRate, threshold = 0.004, padMs = 120) {
  const n = samples.length;
  if (!n) return samples;
  const win = Math.max(16, Math.floor(sampleRate * 0.02)); // 20 ms windows
  const pad = Math.floor(sampleRate * padMs / 1000);
  let start = 0;
  let end = n;
  outerStart:
  for (let i = 0; i + win <= n; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
    if (Math.sqrt(s / win) > threshold) { start = Math.max(0, i - pad); break outerStart; }
  }
  outerEnd:
  for (let i = n - win; i >= 0; i -= win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
    if (Math.sqrt(s / win) > threshold) { end = Math.min(n, i + win + pad); break outerEnd; }
  }
  if (end <= start) return samples;
  return samples.slice(start, end);
}

// Keep only the loudest maxMs of speech. wav2vec2 cost is ~O(audio length);
// long recordings with leftover room-noise were the leftover wait on phones.
function capSpeechWindow(samples, sampleRate, maxMs = 4500) {
  const maxN = Math.floor(sampleRate * maxMs / 1000);
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

// PCM float → 16-bit mono WAV (for You-wave playback after silence trim)
function floatToWavBlob(samples, sampleRate = 16000) {
  const n = samples ? samples.length : 0;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ascii = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
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

export { decodeAudioToMono, audioStats, normalizeForModel, trimSilence, capSpeechWindow, floatToWavBlob };
