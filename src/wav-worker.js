/* Classic worker. Part 2 WAV encode stays off the mic tap. */
self.onmessage = (event) => {
  const chunks = event.data.chunks || [];
  const sampleRate = event.data.sampleRate || 48000;
  let len = 0;
  for (let i = 0; i < chunks.length; i++) len += chunks[i].length;
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const wstr = (s, p) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  wstr('RIFF', 0);
  v.setUint32(4, 36 + len * 2, true);
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
  v.setUint32(40, len * 2, true);
  let p = 44;
  for (let c = 0; c < chunks.length; c++) {
    const samples = chunks[c];
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }
  self.postMessage({ buf }, [buf]);
};
