/* global importScripts, ort */
// MRJ Pronounce — Dedicated single-thread WASM Web Worker for HuBERT phoneme CTC inference

let session = null;

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const { id, type } = msg;
  try {
    if (type === 'init') {
      const wasmPaths = msg.wasmPaths || '../vendor/ort/';
      if (typeof ort === 'undefined') {
        importScripts(wasmPaths + 'ort.wasm.min.js');
      }
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = wasmPaths;
      session = await ort.InferenceSession.create(msg.modelBuffer, {
        executionProviders: ['wasm'],
      });
      self.postMessage({ id, ok: true, ready: true });
      return;
    }

    if (type === 'forward') {
      if (!session) throw new Error('HuBERT worker session is not initialized');
      const samples = msg.samples instanceof Float32Array
        ? msg.samples
        : new Float32Array(msg.samples);
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const input = new ort.Tensor('float32', samples, [1, samples.length]);
      const out = await session.run({ input_values: input });
      const inferMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      const logits = out.logits;
      const dims = logits.dims;
      const copy = new Float32Array(logits.data);
      self.postMessage(
        {
          id,
          ok: true,
          data: copy,
          timeSteps: dims[1],
          vocab: dims[2],
          inferMs,
        },
        [copy.buffer],
      );
      return;
    }

    throw new Error('Unknown worker command: ' + type);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
