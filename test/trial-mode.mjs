import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as trial from '../src/trial.js';
import * as engine from '../src/engine.js';
import * as audio from '../src/audio.js';
import * as app from '../src/app.js';
import { canStartMic, noteAttempt, emptyFlow, lineOpenFor } from '../src/flow.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cmuJson = JSON.parse(readFileSync(join(root, 'models/cmudict.full.json'), 'utf8'));
const aidJson = JSON.parse(readFileSync(join(root, 'models/arpabet_to_ids.json'), 'utf8'));
engine.initG2PFromData(cmuJson, aidJson);

test('text door check functions are completely deleted from trial.js and engine.js', () => {
  assert.equal('DOOR_OVERLAP' in trial, false, 'DOOR_OVERLAP must be deleted');
  assert.equal('overlapRatio' in trial, false, 'overlapRatio must be deleted');
  assert.equal('closeWord' in trial, false, 'closeWord must be deleted');
  assert.equal('doorFromTranscript' in trial, false, 'doorFromTranscript must be deleted');
  assert.equal('greedyCitrinetTranscript' in trial, false, 'greedyCitrinetTranscript must be deleted');
});

test('shared boot helpers expose lazy-load API for embeds', async () => {
  const shared = await import('../src/shared.js');
  assert.equal(typeof shared.bootShared, 'function');
  assert.equal(typeof shared.ensureModel, 'function');
  assert.equal(typeof shared.getModelBootState, 'function');
  assert.equal(typeof shared.resetSharedBoot, 'function');
  assert.equal(trial.getTrialBootState(), 'idle');
});

test('fetchPartWithProgress rejects a stalled part download', async () => {
  const hang = () =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve(
          new Response(
            new ReadableStream({
              pull() {
                /* never sends bytes */
              },
            }),
            { status: 200 },
          ),
        );
      }, 5);
    });
  await assert.rejects(
    trial.fetchPartWithProgress('https://example.test/part-00.bin', hang, {
      stallMs: 80,
      onHeartbeat: () => {},
    }),
    /Download stopped too long/i,
  );
}, { timeout: 5000 });

test('bootModelPaths lists HuBERT phoneme model parts and full CMUdict', () => {
  const paths = trial.bootModelPaths();
  assert.ok(paths.includes('models/hubert/manifest.json'));
  assert.ok(paths.includes('models/hubert/part-00.bin'));
  assert.ok(paths.includes('models/cmudict.full.json'));
  assert.ok(!paths.some((p) => p.includes('citrinet')));
  assert.ok(!paths.some((p) => p.includes('phone_overrides')));
});

test('full CMUdict + English phonics G2P rules cover any word written in English letters', () => {
  // Known CMUdict word
  const school = engine.phonesForWord('school');
  assert.equal(school.source, 'cmudict');
  assert.deepEqual(school.phones, ['S', 'K', 'UW', 'L']);

  // Made-up phonics word (never in any dictionary)
  const blimpet = engine.phonesForWord('blimpet');
  assert.ok(blimpet.phones.length >= 5);
  assert.deepEqual(engine.unknownWords('The blimpet Zorgath glimpsed a snorflax'), []);
  assert.equal(engine.dictionaryCoverage('The blimpet Zorgath glimpsed a snorflax'), 1);
});

test('phoneme-level scores roll up to word and line with no floor or boost', () => {
  // Construct synthetic logits for "It is" -> IH T (It), IH Z (is)
  const expected = engine.expectedPhoneSequence('It is');
  assert.deepEqual(expected.phones, ['IH', 'T', 'IH', 'Z']);

  const T = 16;
  const V = engine.VOCAB_SIZE;
  const logits = [];
  const phoneIds = expected.phones.map((p) => engine.PHONE_TO_ID[p]);

  for (let t = 0; t < T; t++) {
    const row = new Float32Array(V).fill(-8);
    row[engine.BLANK_ID] = -2;
    const targetIdx = Math.min(3, Math.floor(t / 4));
    row[phoneIds[targetIdx]] = 6.0; // Clear acoustic spike on expected phoneme
    logits.push(row);
  }

  const res = engine.scoreUtteranceFromLogits(logits, T, 'It is', { appId: 'day4' });
  assert.equal(res.acousticFail, false);
  assert.equal(res.pass, true);
  assert.equal(res.band, 'green');
  assert.equal(res.words.length, 2);
  assert.ok(res.words[0].score >= 90);
  assert.ok(res.words[1].score >= 90);
  assert.equal(res.words[0].phones.length, 2);
  assert.equal(res.words[1].phones.length, 2);
});

test('acoustic gate rejects wrong phoneme sequence (sound-only likelihood ratio)', () => {
  // Audio emits strong 'W AH T  T AY M' ("what time") while target is "It is here"
  const wrongPhones = ['W', 'AH', 'T', 'T', 'AY', 'M', 'IH', 'Z', 'IH', 'T'];
  const T = 30;
  const V = engine.VOCAB_SIZE;
  const logits = [];
  for (let t = 0; t < T; t++) {
    const row = new Float32Array(V).fill(-8);
    row[engine.BLANK_ID] = -1;
    const p = wrongPhones[Math.min(wrongPhones.length - 1, Math.floor((t / T) * wrongPhones.length))];
    row[engine.PHONE_TO_ID[p]] = 5.5;
    logits.push(row);
  }

  const res = engine.scoreUtteranceFromLogits(logits, T, 'It is here', { appId: 'day4' });
  assert.equal(res.acousticFail, true);
  assert.equal(res.doorFail, true);
  assert.equal(res.pass, false);
  assert.equal(res.band, 'red');
});

test('Korean-L1 wrong-sound diagnostics identify f/p, v/b, r/l, θ/s, ð/d, vowel swaps, dropped final consonant, added final vowel', () => {
  const V = engine.VOCAB_SIZE;
  const makeLogitsForHeard = (heardSeq, framesPerPhone = 4) => {
    const logits = [];
    for (const p of heardSeq) {
      for (let k = 0; k < framesPerPhone; k++) {
        const row = new Float32Array(V).fill(-8);
        row[engine.BLANK_ID] = -2;
        if (p === 'BLANK') {
          row[engine.BLANK_ID] = 6;
        } else {
          row[engine.PHONE_TO_ID[p]] = 5.0;
        }
        logits.push(row);
      }
    }
    return logits;
  };

  // 1. f -> p substitution on "fan" (F AE N heard as P AE N)
  {
    const logits = makeLogitsForHeard(['P', 'AE', 'N']);
    // Give slight mass to F so alignment still anchors F on the first segment
    for (let t = 0; t < 4; t++) logits[t][engine.PHONE_TO_ID.F] = 1.5;
    const res = engine.scoreUtteranceFromLogits(logits, logits.length, 'fan', {
      appId: 'phonics',
      acousticMarginCut: -5,
    });
    const fPhone = res.words[0].phones[0];
    assert.equal(fPhone.phone, 'F');
    assert.equal(fPhone.heardPhone, 'P');
    assert.equal(fPhone.l1Pattern, 'f_to_p');
  }

  // 2. r -> l substitution on "red" (R EH D heard as L EH D)
  {
    const logits = makeLogitsForHeard(['L', 'EH', 'D']);
    for (let t = 0; t < 4; t++) logits[t][engine.PHONE_TO_ID.R] = 1.5;
    const res = engine.scoreUtteranceFromLogits(logits, logits.length, 'red', {
      appId: 'phonics',
      acousticMarginCut: -5,
    });
    const rPhone = res.words[0].phones[0];
    assert.equal(rPhone.phone, 'R');
    assert.equal(rPhone.heardPhone, 'L');
    assert.equal(rPhone.l1Pattern, 'r_to_l');
  }

  // 3. θ -> s substitution on "thin" (TH IH N heard as S IH N)
  {
    const logits = makeLogitsForHeard(['S', 'IH', 'N']);
    for (let t = 0; t < 4; t++) logits[t][engine.PHONE_TO_ID.TH] = 1.5;
    const res = engine.scoreUtteranceFromLogits(logits, logits.length, 'thin', {
      appId: 'phonics',
      acousticMarginCut: -5,
    });
    const thPhone = res.words[0].phones[0];
    assert.equal(thPhone.phone, 'TH');
    assert.equal(thPhone.heardPhone, 'S');
    assert.equal(thPhone.l1Pattern, 'th_to_s');
  }

  // 4. Dropped final consonant on "cat" (K AE T heard as K AE with blank at tail)
  {
    const logits = makeLogitsForHeard(['K', 'AE', 'BLANK']);
    const res = engine.scoreUtteranceFromLogits(logits, logits.length, 'cat', {
      appId: 'phonics',
      acousticMarginCut: -5,
    });
    const tPhone = res.words[0].phones[2];
    assert.equal(tPhone.phone, 'T');
    assert.equal(tPhone.l1Pattern, 'dropped_final_consonant');
  }

  // 5. Added final vowel (epenthesis) after final consonant on "bus" (B AH S + strong UH)
  {
    const logits = makeLogitsForHeard(['B', 'AH', 'S', 'UH'], 3);
    const res = engine.scoreUtteranceFromLogits(logits, logits.length, 'bus', {
      appId: 'phonics',
      acousticMarginCut: -5,
    });
    const sPhone = res.words[0].phones[2];
    assert.equal(sPhone.phone, 'S');
    assert.equal(sPhone.l1Pattern, 'added_final_vowel');
  }
});

test('near-field gate drops voiced segments >= 12 dB quieter than main speaker', () => {
  const sr = 16000;
  // 0.5s of loud main speaker (amplitude 0.5, 180 Hz) + 0.5s of quiet classmate (-16 dB -> amp 0.07, 260 Hz)
  const samples = new Float32Array(sr);
  for (let i = 0; i < sr / 2; i++) {
    samples[i] = 0.5 * Math.sin((2 * Math.PI * 180 * i) / sr);
  }
  for (let i = sr / 2; i < sr; i++) {
    samples[i] = 0.06 * Math.sin((2 * Math.PI * 260 * i) / sr);
  }
  const gated = audio.applyNearFieldGate(samples, sr, { dropDb: 12 });
  assert.ok(gated.droppedFrames >= 15, `expected quiet classmate frames dropped, got ${gated.droppedFrames}`);
  assert.ok(gated.keptFrames >= 20, `expected main speaker frames kept, got ${gated.keptFrames}`);
  const trimmed = audio.trimSilence(gated.samples, sr);
  // After gating and re-trimming, duration should be ~0.5s (main speaker only), not 1.0s
  assert.ok(trimmed.length < sr * 0.7, `expected trimmed length < 0.7s, got ${trimmed.length / sr}s`);
});

test('red / yellow / green banding, and the mic stays tappable after a score', () => {
  // Yellow is nearly right -> student may move on (pass: true), logged with assistedPass: true
  const flow0 = emptyFlow();
  const yellowGrade = {
    score: 0.68,
    scorePct: 68,
    band: 'yellow',
    pass: true,
    assistedPass: true,
    yellowWords: ['janitor'],
  };
  const flow1 = noteAttempt(flow0, 'line1', yellowGrade);
  assert.equal(flow1.student.line1.pass, true);
  assert.equal(flow1.student.line1.band, 'yellow');
  assert.equal(flow1.student.line1.assistedPass, true);
  assert.deepEqual(flow1.student.line1.yellowWords, ['janitor']);

  // Model voice may play, but it must not grey out the mic or start a recording.
  assert.equal(app.shouldPlayMandatoryAudio(yellowGrade, null), true);
  assert.equal(
    canStartMic({
      phase: 'part1',
      recording: false,
      timerRunning: false,
      lineOpen: true,
      playingMandatoryAudio: true,
    }),
    true,
  );
  assert.equal('pendingRetryWords' in app, false);
  assert.equal('mergeRetryResult' in trial, false);

  const missed = {
    score: 0.55,
    scorePct: 55,
    band: 'yellow',
    pass: false,
    reason: 'Tap the mic to try the whole sentence again.',
    words: [
      { word: 'Where', score: 85, scorePct: 85 },
      { word: 'is', score: 62, scorePct: 62 },
      { word: 'the', score: 40, scorePct: 40 },
    ],
  };
  const flowMiss = noteAttempt(emptyFlow(), 'line1', missed);
  assert.equal(flowMiss.fails.line1, 1);
  assert.equal(lineOpenFor(flowMiss, 'line1'), true);
  const html = app.partResultHtml(missed);
  assert.equal(html.includes('missed'), false);
  assert.equal(html.includes('fail yellow'), true);
  assert.equal(html.includes('Tap the mic to try the whole sentence again.'), true);
  assert.equal(html.includes('word-chip yellow'), true);
  assert.equal(html.includes('word-chip good green'), true);
  assert.equal(html.includes('word-chip bad red'), true);

  const almost = { scorePct: 68, score: 0.68, pass: true, band: 'yellow', words: [{ word: 'here', scorePct: 68 }] };
  const almostHtml = app.partResultHtml(almost);
  assert.equal(almostHtml.includes('pass yellow'), true);
  assert.equal(almostHtml.includes('Almost (Move on)'), true);

  // A 0–1 word score must still land in yellow, not get rounded down to red.
  const scaled = app.partResultHtml({
    scorePct: 0.62,
    pass: true,
    words: [{ word: 'here', score: 0.62 }],
  });
  assert.equal(scaled.includes('62'), true);
  assert.equal(scaled.includes('word-chip yellow'), true);
});
