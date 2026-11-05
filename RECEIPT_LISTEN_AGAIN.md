# Receipt — Listen again on the Results screen (2026-11-06)

Jay (verbatim): "For the day 4 pronounce activity, once the student has finished and the results
are showing, they should still have a button to listen to the sentence again so they can practice."

Build pin: `20261106-listen-again` (was `20261103-day4-shared-grade-v3`).

## What changed

| File | Change |
|---|---|
| `src/app.js` | Results phase renders a `Listen ▶` button on every line, every part, and the shared question — instead of the disabled Mic button. English sentence stays on screen at Results. |
| `src/app.js` | On-demand replay goes through one helper, `replaySentence(rel)`; each tap builds a fresh `Audio` from the pre-baked mp3, so nothing is torn down and the clip is still playable after a score. |
| `src/app.js` | Public hook for host pages: `window.MRJ_HEAR.play(rel)`, `window.MRJ_HEAR.playFor(scoreKey)`, `window.MRJ_HEAR.rel(scoreKey)`, `window.MRJ_HEAR.stop()`, `window.MRJ_HEAR.voice()`, and the `mrj-hear` DOM event. |
| `preview-assets/pronounce-preview.css` | `body.phase-results` now shows `.part-text`, `.en-prompt`, `.part-label`. Before, a blanket `display:none !important` hid the sentence everywhere, including after a try. |
| `index.html`, `preview.html`, `src/*.js` | Build pin bumped so students get the new files (no cache).

Audio is a pre-baked mp3 in the repo: `audio/<item>__<id>.mp3`, with the Miss Harper twin in
`audio_harper/`. No TTS call at replay time. Voice toggle decides the file; Coach Ray is the default.

## Not changed

Part 1 still hides the English answer before a try, Part 2 (timer) still cannot replay, mic rules,
scoring, and the model are untouched.

## Checked

- Unit `basic_a/unit01` results: 10 lines, 10 Listen buttons, sentence text visible.
- Unit `int3a/unit02` results: 10 lines + shared question, 11 Listen buttons, sentences visible.
- `part1` of the same unit: no Listen buttons (test mode), Mic buttons present, English hidden.
- Hook: `playFor('<item>::answer')` and the `mrj-hear` event both fetched the right mp3 (200).
- `node --test` per file: all pass except `test/unpassable-25-words.mjs` (needs a browser fetch base;
  it fails on clean `main` too).
