# Pronunciation practice (pure mode)

Standalone GitHub Pages app for free-type English, phrase books, My Guides, and local history. Uses the same HuBERT grader as Day 4 (`../src/shared.js`, `../models/hubert/`).

## Open it

After merge to `main` (GitHub Pages):

**https://mrjkorea.github.io/pronounce/practice/**

Local check (from repo root):

```bash
npx --yes serve -l 4173
```

Then open `http://127.0.0.1:4173/practice/` (paths assume the repo is served at `/`; on GitHub Pages the site root is `/pronounce/`).

## Features

- **Practice** — type English, **Bella** 👩 / **Puck** 👨 listen, mic record (auto-stop ~1.3s silence), HuBERT word chips (green ≥75, yellow 50–74, red &lt;50; pass when line average ≥60).
- **Books** — five packs × 25 phrases (`content/books.json`): Greetings, Classroom, Shopping, Travel, Daily.
- **My Guides** — up to 200 guides × 20 sentences in `localStorage`.
- **History** — search, stats, JSON/CSV export (365-day / 5000-entry cap).
- **UI languages** — 14 L1 strings in `js/i18n.js`.

## Scores (2026-11-11)

Every finished phrase writes one row, the same way Day 4 does:

- `../mrj-scores.js` posts to the Classroom Metrics book (`source: pronounce-practice`, `appName: MRJ Pronounce Practice`, `curriculum_program: pronounce`).
- `MRJ_AUTH.noteScore()` also updates the student score index.
- Item id is `pronounce:practice:<8-hex hash of the phrase>`, so one phrase is one item and a retry appends a row with `attempt` / `re_attempt` in the metadata.
- The page loads the shared sign-in (`https://mrjkorea.github.io/mrj-signin/`). No signed-in student, no row: the page never posts an orphan.
- `js/score.js` holds the item id, attempt count and row builder; `test/practice-score.mjs` holds the tests.
- `tools/proof-practice-scores.mjs` signs in with a test ID, records a real clip through a fake mic, grades it with HuBERT and prints the posted row.

## Listen (Kokoro)

The app tries **Kokoro** (`af_bella` / `am_puck`) via `@huggingface/transformers` + `onnx-community/Kokoro-82M-v1.0-ONNX` from jsDelivr (no model blobs in git). If CDN load fails, it uses **labeled OS speech** and shows a short notice in the header.

## Day 4

Root `index.html` and `src/app.js` are unchanged. Link from the public site as **Pronunciation practice** → `/pronounce/practice/`.
