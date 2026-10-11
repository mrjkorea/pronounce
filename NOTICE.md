# Notices

The Day 4 citrinet trial grades in the browser. After these files are on the page, a take does not send audio off the device.

- Whistle door: `whistle.cact` from Cactus Compute (`Cactus-Compute/whistle`), Apache-2.0. The page loads it with the official Needle WASM engine (`needle.js` / `needle.wasm`).
- Citrinet grade: `model.int8.onnx` and `tokens.txt` from the sherpa-onnx release `sherpa-onnx-nemo-ctc-en-citrinet-512`. The weights are NVIDIA's `stt_en_citrinet_512` model, license CC-BY-4.0. The sentence pieces come from that model's SentencePiece tokenizer (`tokenizer.model`).
- ZIPA hint, red words only: `anyspeech/zipa-small-crctc-500k` `model.int8.onnx` and `tokens.txt`, license CC BY 4.0. Credit Jian Zhu and the ZIPA authors.
- Spoken hint spelling uses a vendored eSpeak NG phonemizer (`vendor/espeak`, en-US). eSpeak NG is GPL-3.0-or-later. The phonemizer package wrapper is Apache-2.0.

The old wav2vec2 checker stays on disk. This trial does not load it while `GRADER` is `citrinet-trial`.
