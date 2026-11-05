# Receipt — Try again on Day 4 (TRY_AGAIN_SPEC, 2026-11-06)

Rule: `~/OpenBot/Shared/conversation-activity-inventory/TRY_AGAIN_SPEC.md` (MRJ CONVERSATION).
Build pin: `20261106-try-again` (was `20261106-listen-again`).

## What changed

| File | Change |
|---|---|
| `src/attempts.js` | New, pure: append-only per-`page_id` attempt store. Keeps `firstDoneAt`, `lastAttemptAt`, `bestScore` = max, `pass` = any, `attempts[]`. A reload of the same try never doubles it; an older single-result record reads as try 1; broken JSON never throws. |
| `src/flow.js` | `emptyFlow`/`normalizeFlow` carry `tryNo` and `tryStartedAt`; new `retryFlow(flow, now)` starts try N+1 at `part1` and keeps `teacher` passes. Part 1 / Part 2 / timer untouched. |
| `src/app.js` | Results screen: `Try N · X%`, `Try N · every try is kept`, `Best 90% (try 1)` (only when 2+ tries), one **Done** link and one **🔁 Try again** button. Tap opens the one card: "Try again? / Your result now is saved. Nothing is erased. / [Yes, try again] [No, keep this]". Yes → same unit, first line, same voice and settings. Chip **Try N** beside the unit title while running. Reaching Results appends the try once, then posts it. |
| `src/score-reporting.js` | `buildSheetAttemptPost`: one ClassroomMetrics row per finished try, item id `pronounce:<book>:<unit>:try<N>`, metadata `attempt`, `re_attempt`, `part1_passed`, `part2_passed`, `total`, `source`. |
| `src/styles.css` | Chip, Done / Try again buttons, the warning card. |
| `test/try-again.mjs` | New: 9 tests for append-only, best, dates, reload-safety, old record, retry flow. |
| `index.html`, `preview.html`, `src/*.js` | Build pin bump. |

## What is never erased by Try again

Earlier attempt rows, first completion date, best score, pass, teacher passes, and every path square:
the retry resets only the sheet's own part 1 / part 2 state, and it never touches the score pack
(`loadScores` / `saveScores`), which is what fills the squares.

## Checked

- Results on `basic_a/unit01` try 1: `Try 1 · 0%`, Done, Try again; the card shows both lines.
- Tap Try again → card; **No, keep this** closes it, results stay.
- **Yes, try again** → `part1`, line 1, mic ready, chip `Try 4` when it is try 4, scrolled to top.
- Try 2 at 80% after try 1 at 90%: `Try 2 · 80%`, `Try 2 · every try is kept`, `Best 90% (try 1)`;
  store has rows `[1 → 90 pass], [2 → 80]`, `attemptCount 2`, first date unchanged.
- Reload of the results screen adds no second row and posts nothing twice.
- Post payload: `itemId pronounce:basic_a:unit01:try3`, `metadata.attempt 3`, `re_attempt true`.
- `node --test` per file: all pass except `test/unpassable-25-words.mjs` (browser-fetch test; fails on
  clean `main` too).
