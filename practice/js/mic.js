import { RAW_MIC_CONSTRAINTS } from '../../src/audio.js';

export const SILENCE_MS = 1300;
export const SILENCE_GRACE_MS = 900;
const SILENCE_CHECK_MS = 120;
const SILENCE_RMS = 0.018;
const MAX_RECORD_MS = 60000;

let silenceTimer = null;
let silenceNodes = null;

function stopSilenceWatch() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  if (silenceNodes) {
    try { silenceNodes.src.disconnect(); } catch (_) {}
    try { silenceNodes.analyser.disconnect(); } catch (_) {}
    try { if (silenceNodes.sink) silenceNodes.sink.disconnect(); } catch (_) {}
    silenceNodes = null;
  }
}

function startSilenceWatch(stream, ctx, onDone) {
  stopSilenceWatch();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    stopSilenceWatch();
    onDone();
  };
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.25;
    src.connect(analyser);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(ctx.destination);
    silenceNodes = { src, analyser, sink };
    const buf = new Uint8Array(analyser.fftSize);
    let quietMs = 0;
    let totalMs = 0;
    let spoke = false;
    const tick = () => {
      if (finished) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      totalMs += SILENCE_CHECK_MS;
      if (rms >= SILENCE_RMS) {
        spoke = true;
        quietMs = 0;
      } else if (totalMs >= SILENCE_GRACE_MS && spoke) {
        quietMs += SILENCE_CHECK_MS;
      }
      if (quietMs >= SILENCE_MS || totalMs >= MAX_RECORD_MS || (!spoke && totalMs >= 8000)) {
        finish();
        return;
      }
      silenceTimer = setTimeout(tick, SILENCE_CHECK_MS);
    };
    silenceTimer = setTimeout(tick, SILENCE_CHECK_MS);
  } catch (_) {
    silenceTimer = setTimeout(finish, 4000);
  }
}

function startCapture(stream) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const chunks = [];
  proc.onaudioprocess = (e) => {
    if (!proc._on) return;
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  proc._on = true;
  src.connect(proc);
  proc.connect(gain);
  gain.connect(ctx.destination);
  return { ctx, proc, gain, chunks, stream };
}

function encodeWav(floatChunks, sampleRate) {
  let len = 0;
  for (const c of floatChunks) len += c.length;
  const samples = new Float32Array(len);
  let o = 0;
  for (const c of floatChunks) {
    samples.set(c, o);
    o += c.length;
  }
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const wstr = (s, p) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  wstr('RIFF', 0);
  v.setUint32(4, 36 + samples.length * 2, true);
  wstr('WAVE', 8);
  wstr('fmt ', 12);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr('data', 36);
  v.setUint32(40, samples.length * 2, true);
  let p = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    p += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Record from mic until silence (~1.3s) after speech. Returns WAV blob.
 */
export async function recordOnce() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: RAW_MIC_CONSTRAINTS,
    video: false,
  });
  const rec = startCapture(stream);
  return new Promise((resolve, reject) => {
    startSilenceWatch(stream, rec.ctx, () => {
      try {
        rec.proc._on = false;
        rec.proc.disconnect();
        rec.gain.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        const rate = rec.ctx.sampleRate || 48000;
        const blob = encodeWav(rec.chunks, rate);
        rec.ctx.close().catch(() => {});
        resolve(blob);
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function stopAnySilenceWatch() {
  stopSilenceWatch();
}
