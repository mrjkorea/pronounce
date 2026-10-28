/**
 * Bella (af_bella) & Puck (am_puck) listen path.
 * Tries Kokoro via @huggingface/transformers CDN; falls back to labeled OS speech.
 */

const VOICES = {
  bella: { id: 'af_bella', label: 'Bella', gender: 'female' },
  puck: { id: 'am_puck', label: 'Puck', gender: 'male' },
};

let mode = 'pending'; // pending | kokoro | os
let kokoroPipeline = null;
let currentVoice = 'bella';

export function getTtsMode() {
  return mode;
}

export function setVoice(id) {
  if (VOICES[id]) currentVoice = id;
}

export function getVoice() {
  return currentVoice;
}

function pickOsVoice(gender) {
  if (typeof speechSynthesis === 'undefined') return null;
  const list = speechSynthesis.getVoices();
  const en = list.filter((v) => /en/i.test(v.lang));
  const pool = en.length ? en : list;
  const female = pool.find((v) => /female|woman|zira|samantha|karen|moira|fiona|victoria/i.test(v.name));
  const male = pool.find((v) => /male|man|daniel|alex|fred|david|tom/i.test(v.name));
  if (gender === 'female') return female || pool[0] || null;
  return male || pool.find((v) => v !== female) || pool[0] || null;
}

function speakOs(text, gender) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('speechSynthesis unavailable'));
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.92;
    const v = pickOsVoice(gender);
    if (v) u.voice = v;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

async function tryLoadKokoro(onStatus) {
  if (kokoroPipeline) {
    mode = 'kokoro';
    return true;
  }
  try {
    onStatus?.('Loading Kokoro voices (CDN)…');
    const { pipeline, env } = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0/dist/transformers.min.js'
    );
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    kokoroPipeline = await pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
    });
    mode = 'kokoro';
    onStatus?.('');
    return true;
  } catch (err) {
    console.warn('Kokoro CDN load failed, using OS voices:', err);
    mode = 'os';
    onStatus?.('');
    return false;
  }
}

async function speakKokoro(text, voiceId) {
  if (!kokoroPipeline) throw new Error('no kokoro');
  const out = await kokoroPipeline(text, { voice: voiceId });
  const audio = out?.audio || out;
  const sr = out?.sampling_rate || 24000;
  if (audio instanceof AudioBuffer) {
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);
    await new Promise((res) => {
      src.onended = () => { ctx.close().catch(() => {}); res(); };
      src.start(0);
    });
    return;
  }
  if (audio && typeof audio.length === 'number') {
    const wav = floatToWav(audio, sr);
    const url = URL.createObjectURL(wav);
    await playUrl(url);
    URL.revokeObjectURL(url);
  }
}

function floatToWav(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    o += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function playUrl(url) {
  return new Promise((resolve) => {
    const a = new Audio(url);
    a.onended = () => resolve();
    a.onerror = () => resolve();
    a.play().catch(() => resolve());
  });
}

export async function initTts(onStatus) {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.getVoices();
  }
  await tryLoadKokoro(onStatus);
  if (mode === 'pending') mode = 'os';
}

export function ttsNoteText() {
  if (mode === 'kokoro') return '';
  return 'Listen: temporary OS voice (Bella 👩 / Puck 👨 labels). Kokoro loads from CDN when available.';
}

export async function speak(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  const spec = VOICES[currentVoice];
  if (mode === 'kokoro' && kokoroPipeline) {
    try {
      await speakKokoro(trimmed, spec.id);
      return;
    } catch (e) {
      console.warn('Kokoro speak failed', e);
    }
  }
  await speakOs(trimmed, spec.gender);
}
