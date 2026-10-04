/* Classic worker. One WASM thread. No COOP/COEP. No module worker. */
importScripts('../vendor/ort/ort.wasm.min.js');

let session = null;
const queue = [];
let pumping = false;

function ortLib() {
  return self.ort;
}

async function handle(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'init') {
    const ort = ortLib();
    if (!ort) throw new Error('sound checker script missing');
    ort.env.wasm.wasmPaths = msg.wasmPaths;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    session = await ort.InferenceSession.create(msg.model, { executionProviders: ['wasm'] });
    self.postMessage({ type: 'ready', numThreads: 1 });
    return;
  }
  if (msg.type === 'run') {
    if (!session) throw new Error('sound checker is not ready');
    const ort = ortLib();
    const input = msg.input;
    const tensor = new ort.Tensor('float32', input, [1, input.length]);
    const results = await session.run({ input_values: tensor });
    const dims = Array.from(results.logits.dims);
    const data = new Float32Array(results.logits.data);
    self.postMessage({ type: 'logits', id: msg.id, dims, data }, [data.buffer]);
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const msg = queue.shift();
    try {
      await handle(msg);
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: msg && msg.id,
        message: err && err.message ? err.message : String(err),
      });
    }
  }
  pumping = false;
}

self.onmessage = (ev) => {
  queue.push(ev.data);
  pump();
};
