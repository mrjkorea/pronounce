# CURSOR_RECEIPT — Day 4 web

Date: 23 Sep 2026
Workspace: `/Users/andreclouthier/.hermes/projects/mrj-pronounce-app`
App folder: `day4-web/`
No git push.

## Model

- Name: `facebook/wav2vec2-lv-60-espeak-cv-ft` (Wav2Vec2ForCTC)
- File: `model_int8.onnx` (int8), runtime id `wav2vec2-lv-60-espeak-cv-ft-onnx-int8`
- Scoring: CTC forced GOP (`forcedAlignGop` + `aggregate`), blank id 0
- Parts: **8** (`part-00.bin` … `part-07.bin`), each under 45 MB
- Sum: **317712780** bytes
- sha256: `74174710e34035bbb7f611601d016c32fc575de7a6f53b1078107dc10a84e7ae` (matches the source onnx)
- Runtime: onnxruntime-web WASM, `numThreads = 1`, `proxy = false`, `executionProviders: ['wasm']`
- WASM files: `vendor/ort/ort.wasm.min.js` (one string pointed at the asyncify glue), `ort-wasm-simd-threaded.asyncify.mjs`, `ort-wasm-simd-threaded.asyncify.wasm`
- `wasmPaths` is the absolute URL of `vendor/ort/`. A bare `vendor/ort/` string is not a valid `import()` specifier in the browser.

## Content

- 9 books, 72 units, **716** lines
- Basic A unit 3: 9 lines. Basic A unit 4: 7 lines
- Book order on the home page: Basic A, Basic B, Basic C, Int 3A, Int 3B, Int 3C, Int 2A, Int 2B, Int 2C
- Dictionary: `models/cmudict.day4.json` has 655 of 680 English word tokens
- 25 words are in `MISSING_WORDS.txt` (no invented phonemes). A line with one of those words cannot pass.

## Files

- `index.html`, `styles.css`, `src/app.js`, `src/engine.js`, `src/audio.js`
- `content/` manifest + 9 book files
- `models/cmudict.day4.json`, `phone_overrides.json`, `arpabet_to_ids.json`
- `models/wav2vec2/` manifest, vocab, config, preprocessor, 8 part files
- `vendor/ort/` the three runtime files above
- `MISSING_WORDS.txt`, `check_day4.py`, `tools/probe_session.mjs`

## Tests

```
content ok: books=9 units=72 items=716
dictionary ok: words=680 in_dict=655 missing=25
model ok: parts=8 bytes=317712780 sha256=74174710e34035bbb7f611601d016c32fc575de7a6f53b1078107dc10a84e7ae
node --check: app.js, engine.js, audio.js, probe_session.mjs, ort.wasm.min.js, asyncify.mjs — all ok
```

`onnxruntime-node` could not create a session (`ConvInteger` is not implemented in that build). Node did not run the WASM session.

Browser check (Chromium, local server): `InferenceSession.create` on the assembled buffer succeeded. `?probe=1` ran 1600 samples of silence (0.1 s at 16 kHz). Logits shape **1x4x392**.

Second page load did not request `part-*.bin` again. The Cache API hit was used.

Sheet check: Basic A unit 3 shows 9 Korean lines and no English. After a saved try, that line shows Pass, weak words, the English, and Hear. Untouched lines stay Korean only.

## Pass rule

Pass only when the GOP score is at least 0.80, the speech window is not too quiet, and the speech is at least 200 ms per English word. A missing dictionary word fails the line. Loud noise does not pass on its own.
