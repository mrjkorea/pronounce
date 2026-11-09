Wire the tested three-step checker into this live Day 4 kids page.

The working trial is in `/Users/andreclouthier/.hermes/projects/pronounce-try/`.
Jay tried that page and said it worked. This repo is the kids page `https://mrjkorea.github.io/pronounce/`.

Already copied here:
- `src/trial.js`, `src/citrinet-encode.js`, `src/nemo-fbank.js`
- `models/citrinet/`, `models/whistle/`, `models/zipa/`
- `vendor/needle/`, `vendor/espeak/`

Do this:
1. Read the trial wiring in `/Users/andreclouthier/.hermes/projects/pronounce-try/src/app.js` (`GRADER`, `bootModel`, `gradeBlob`, word chips, door fail text).
2. Apply that same wiring to THIS repo's `src/app.js`.
3. Do not delete `progress-merge.js`, the auth pack, score posts, or the stop-mic behavior. Those are newer than the trial page. Keep them.
4. Default `GRADER` is `citrinet-trial`. A comment says set it to `wav2vec2` to go back. Do not load `models/wav2vec2/model_int8.onnx` on the trial path.
5. Add `<script src="vendor/needle/needle.js"></script>` to `index.html` before the app module. Do not remove the sign-in scripts or `mrj-scores.js`.
6. Cache-bust every changed import and the index script with `?v=20261010-kids`.
7. A door fail shows only `Say the sentence again, please. Say each word clearly.` No word colors. No score on screen.
8. Green word at 60 or more. Red under 60. A red word may show the hint line.
9. Run `node --check src/app.js`. Do not git push.
