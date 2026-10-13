# Third-party models (browser)

The Day 4 pronounce app grades in the browser. After these files are on the page, a take does not send audio off the device.

- **Citrinet grade:** `models/citrinet/model.int8.onnx` and `models/citrinet/sp_pieces.json` from the sherpa-onnx release `sherpa-onnx-nemo-ctc-en-citrinet-512`. The weights are NVIDIA's `stt_en_citrinet_512` model, license CC-BY-4.0. The sentence pieces come from that model's SentencePiece tokenizer (`tokenizer.model`).
- **Runtime:** onnxruntime-web WASM (`vendor/ort/`), `numThreads = 1`, `executionProviders: ['wasm']`.

Word-level dictionary data in `models/cmudict.day4.json` is used for content validation only, not for scoring.
