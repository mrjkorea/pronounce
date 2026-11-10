import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4173/practice/';
const WAV = '/tmp/fake-mic-phrase.wav';
const ID = process.env.TEST_ID || 'zz_test_pronounce1111';
const PW = process.env.TEST_PW || 'zz-test-pronounce-1111';
const PHRASE = process.env.PHRASE || 'It is here.';

const posts = [];
const consoleErrors = [];

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
page.on('response', (r) => {
  if (r.status() >= 400) consoleErrors.push(`${r.status()} ${r.url().slice(0, 160)}`);
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
});
page.on('request', (r) => {
  if (r.method() === 'POST' && r.url().includes('script.google.com')) {
    posts.push({ url: r.url(), body: r.postData() });
  }
});
page.on('response', async (r) => {
  if (r.request().method() === 'POST' && r.url().includes('script.google.com')) {
    const last = posts[posts.length - 1];
    if (!last) return;
    try {
      last.answer = (await r.text()).slice(0, 200);
    } catch (e) {
      last.answer = '';
    }
  }
});

const gate = '#mrj-auth-gate';

async function fillForm(values, label) {
  const inputs = page.locator(`${gate} .mrj-auth-form input`);
  for (let i = 0; i < values.length; i += 1) await inputs.nth(i).fill(values[i]);
  await page.locator(`${gate} .mrj-auth-form button`, { hasText: label }).click();
}

async function signIn() {
  await page.waitForSelector(`${gate} .mrj-auth-door-new`, { timeout: 60000 });
  // Known test ID: log in first, create only when the book says it is new.
  await page.click(`${gate} .mrj-auth-door-login`);
  await page.waitForSelector(`${gate} .mrj-auth-form input`, { timeout: 10000 });
  await fillForm([ID, PW], 'Log in');
  await page.waitForTimeout(3000);
  const err = await page.textContent(`${gate}`).catch(() => '');
  if (/does not exist/i.test(err || '')) {
    await page.waitForSelector(`${gate} .mrj-auth-door-new`, { timeout: 15000 });
    await page.click(`${gate} .mrj-auth-door-new`);
    await page.waitForSelector(`${gate} .mrj-auth-form input`, { timeout: 10000 });
    await fillForm([ID, PW, PW], 'Make my ID');
  }
  try {
    await page.waitForFunction(() => !!window.MRJ_STUDENT, null, { timeout: 60000 });
  } catch (e) {
    console.error('SIGNIN FAILED, gate says:', (await page.textContent(`${gate}`).catch(() => '')).slice(0, 300));
    throw e;
  }
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await signIn();

const signedIn = await page.evaluate(() => window.MRJ_STUDENT);
const scoreNote = await page.textContent('#scoreNote').catch(() => '');
const hasScoresClient = await page.evaluate(() => !!(window.MRJ_SCORES && window.MRJ_SCORES.post));

await page.waitForFunction(
  () => {
    const b = document.querySelector('#btnRecord');
    return b && !b.disabled;
  },
  null,
  { timeout: 240000 },
);
await page.fill('#practiceText', PHRASE);
await page.click('#btnRecord');
await page.waitForSelector('#lineResult:not([hidden])', { timeout: 180000 });
const result = await page.textContent('#lineResult');
await page.waitForTimeout(6000);
await page.screenshot({ path: '/tmp/practice-proof.png' });

await page.click('.tab[data-tab="books"]');
await page.waitForTimeout(2500);
const bookCards = await page.locator('.book-card').count();
const ttsNote = await page.textContent('#ttsNote').catch(() => '');

const hist = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('pronounce-practice-history-v1') || '[]').map((e) => ({ text: e.text, pct: e.scorePct, attempt: e.attempt }));
  } catch (e) {
    return ['parse-failed'];
  }
});
const queued = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('mrj.score.queue') || '[]').length;
  } catch (e) {
    return -1;
  }
});

const rows = posts.map((p) => {
  let event = null;
  let email = null;
  try {
    const body = JSON.parse(p.body);
    event = body.events && body.events[0] ? body.events[0] : null;
    email = body.student_email;
  } catch (e) {}
  return {
    item_id: event?.item_id,
    student_email: email,
    score_pct: event?.score_pct,
    source: event?.source,
    metadata: event?.metadata_json,
    answer: p.answer,
  };
});

console.log(JSON.stringify({ signedIn, scoreNote, hasScoresClient, result, bookCards, ttsNote, hist, queued, posts: rows, consoleErrors }, null, 2));

await browser.close();
