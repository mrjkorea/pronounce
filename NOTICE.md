# Third-party models and dictionaries (browser)

The MRJ Pronounce engine runs 100% in the browser (single-thread WASM inside a Web Worker) and caches the acoustic model in browser storage (`Cache Storage` / `IndexedDB`). Audio never leaves the device.

- **Acoustic Phoneme CTC Model:** `ron-jo/hubert-base-phoneme-en-onnx` (`models/hubert/part-00.bin`..`part-02.bin`, assembled to `122,222,068` bytes INT8 ONNX), derived from `Peacockery/hubert-base-phoneme-en` (`facebook/hubert-base-ls960` fine-tuned on LibriSpeech 960h with 39 ARPAbet phoneme labels). License: **Apache-2.0**.
- **Pronunciation Lexicon:** `models/cmudict.full.json` built from the CMU Pronouncing Dictionary (`cmusphinx/cmudict`, 124,926 English words, public domain / BSD-style permissive license) paired with a deterministic English phonics grapheme-to-phoneme (G2P) rule engine in `src/engine.js`.
- **Runtime:** `onnxruntime-web` WASM (`vendor/ort/`), `numThreads = 1`, `executionProviders: ['wasm']`, License: **MIT**.
