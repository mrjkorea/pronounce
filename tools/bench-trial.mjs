#!/usr/bin/env node
/**
 * Headless Chrome benchmark for the HuBERT phoneme CTC pronunciation engine.
 * Run from repo root: node tools/bench-trial.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bootModelPaths } from '../src/trial.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wavDir = join(root, 'test', 'bench-wavs');
const TARGET = 'It is here.';
const CHECK_SENTENCE = TARGET;

const CLIPS = [
  { id: 'correct', file: 'correct-it-is-here.wav', target: TARGET },
  { id: 'wrong', file: 'wrong-what-time.wav', target: TARGET },
  { id: 'silence', file: 'silence.wav', target: TARGET },
  { id: 'mumbled', file: 'mumbled-it-is-here.wav', target: TARGET },
];

async function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: opts.quiet ? 'pipe' : 'inherit', ...opts });
    let out = '';
    if (opts.quiet) p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${code}`))));
  });
}

async function ensureWavs() {
  await mkdir(wavDir, { recursive: true });
  const jobs = [
    ['ffmpeg', ['-y', '-i', join(root, 'audio/hear/it-is-here.mp3'), '-ar', '16000', '-ac', '1', join(wavDir, 'correct-it-is-here.wav')]],
    ['ffmpeg', ['-y', '-i', join(root, 'audio/basic_a__unit01__05__five.mp3'), '-ar', '16000', '-ac', '1', join(wavDir, 'word-five.wav')]],
    ['ffmpeg', ['-y', '-f', 'lavfi', '-i', 'flite=text=\'What time is it\':voice=slt', '-ar', '16000', '-ac', '1', join(wavDir, 'wrong-what-time.wav')]],
    ['ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '2', join(wavDir, 'silence.wav')]],
    ['ffmpeg', ['-y', '-i', join(wavDir, 'correct-it-is-here.wav'), '-af', 'volume=0.12,lowpass=f=450,highpass=f=180', join(wavDir, 'mumbled-it-is-here.wav')]],
  ];
  for (const [cmd, args] of jobs) {
    const out = args[args.length - 1];
    try {
      await stat(out);
    } catch {
      await run(cmd, args, { quiet: true });
    }
  }
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const pathOnly = req.url.split('?')[0];
      const rel = pathOnly === '/' ? '/index.html' : pathOnly;
      const file = join(root, decodeURIComponent(rel));
      readFile(file).then((buf) => {
        const base = file.split('/').pop() || '';
        const ext = base.includes('.') ? base.split('.').pop() : '';
        const types = {
          html: 'text/html',
          js: 'text/javascript',
          mjs: 'text/javascript',
          css: 'text/css',
          json: 'application/json',
          onnx: 'application/octet-stream',
          bin: 'application/octet-stream',
          wasm: 'application/wasm',
          wav: 'audio/wav',
          mp3: 'audio/mpeg',
          txt: 'text/plain',
        };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(buf);
      }).catch(() => {
        res.writeHead(404);
        res.end('not found');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}/` });
    });
  });
}

async function diskBootBytes() {
  const extras = [
    'vendor/ort/ort.wasm.min.js',
    'vendor/ort/ort-wasm-simd-threaded.asyncify.mjs',
    'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm',
  ];
  const all = [...new Set(bootModelPaths().concat(extras))];
  let sum = 0;
  for (const rel of all) {
    const st = await stat(join(root, rel));
    sum += st.size;
  }
  return sum;
}

function trackablePath(url) {
  const u = String(url);
  return u.includes('/models/') || u.includes('/vendor/ort/');
}

async function bench(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(300000);
  let bootBytes = 0;
  page.on('response', async (res) => {
    const url = res.url();
    if (!trackablePath(url)) return;
    try {
      const body = await res.body();
      bootBytes += body.length;
    } catch (_) {}
  });
  const t0 = Date.now();
  await page.goto(baseUrl + '?bench=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mrjPronounceBench && document.getElementById('modelLabel')?.classList.contains('done'), {
    timeout: 300000,
  });
  const coldReadyMs = Date.now() - t0;
  const coldBoot = await page.evaluate(() => window.__mrjTrialBoot());

  // Measure sentence latency on 3 runs
  const correctUrl = `${baseUrl}test/bench-wavs/correct-it-is-here.wav`;
  const sentenceTimes = [];
  for (let i = 0; i < 3; i++) {
    const ms = await page.evaluate(async ({ url, sentence }) => {
      const blob = await fetch(url).then((r) => r.blob());
      const t = performance.now();
      await window.__mrjPronounceBench(blob, sentence, {});
      return performance.now() - t;
    }, { url: correctUrl, sentence: CHECK_SENTENCE });
    sentenceTimes.push(Math.round(ms));
  }

  // Measure single-word latency on 3 runs ("Five")
  const wordUrl = `${baseUrl}test/bench-wavs/word-five.wav`;
  const wordTimes = [];
  for (let i = 0; i < 3; i++) {
    const ms = await page.evaluate(async ({ url, word }) => {
      const blob = await fetch(url).then((r) => r.blob());
      const t = performance.now();
      await window.__mrjPronounceBench(blob, word, {});
      return performance.now() - t;
    }, { url: wordUrl, word: 'Five' });
    wordTimes.push(Math.round(ms));
  }

  const accuracy = {};
  for (const passAt of [60, 50]) {
    accuracy[passAt] = {};
    for (const clip of CLIPS) {
      const clipUrl = `${baseUrl}test/bench-wavs/${clip.file}`;
      const out = await page.evaluate(async ({ url, target, passAt }) => {
        const blob = await fetch(url).then((r) => r.blob());
        const graded = await window.__mrjPronounceBench(blob, target, { passAt });
        const words = (graded.result.words || []).map((w) => ({
          word: w.word,
          score: Math.round(w.score || 0),
          band: w.band,
          pass: (w.score || 0) >= passAt,
        }));
        return {
          doorFail: !!graded.result.doorFail,
          pass: !!graded.result.pass,
          band: graded.result.band,
          scorePct: graded.result.scorePct,
          words,
          perf: graded.perf,
        };
      }, { url: clipUrl, target: clip.target, passAt });
      accuracy[passAt][clip.id] = out;
    }
  }

  // Verify reload uses Cache Storage / IndexedDB without re-downloading model parts
  let reloadModelNetworkBytes = 0;
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/models/hubert/part-')) {
      try {
        const body = await res.body();
        reloadModelNetworkBytes += body.length;
      } catch (_) {}
    }
  });
  const tReload0 = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mrjPronounceBench && document.getElementById('modelLabel')?.classList.contains('done'), {
    timeout: 300000,
  });
  const warmReadyMs = Date.now() - tReload0;
  const warmBoot = await page.evaluate(() => window.__mrjTrialBoot());

  const diskBootBytesVal = await diskBootBytes();
  await browser.close();
  return {
    modelId: coldBoot.modelId,
    coldReadyMs,
    warmReadyMs,
    reloadModelNetworkBytes,
    wordLatencyMs: wordTimes,
    sentenceLatencyMs: sentenceTimes,
    checkTimes: sentenceTimes,
    networkBootBytes: bootBytes,
    cachedModelBytes: coldBoot.cachedBytes,
    cachedModelMb: Math.round((coldBoot.cachedBytes / (1024 * 1024)) * 100) / 100,
    diskBootBytes: diskBootBytesVal,
    diskBootMb: Math.round((diskBootBytesVal / (1024 * 1024)) * 10) / 10,
    perfSample: accuracy[60].correct.perf,
    accuracy,
    coldBoot,
    warmBoot,
  };
}

async function main() {
  await ensureWavs();
  const { server, url } = await startStaticServer();
  try {
    const hubertResult = await bench(url);
    const report = {
      generatedAt: new Date().toISOString(),
      checkSentence: CHECK_SENTENCE,
      hubert: hubertResult,
    };
    const outPath = join(root, 'test', 'bench-trial-report.json');
    await writeFile(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.error('\nWrote', outPath);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
