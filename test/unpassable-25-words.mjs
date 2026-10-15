import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as engine from '../src/engine.js';
import * as trial from '../src/trial.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cjsRequire = createRequire(join(root, 'index.html'));

/**
 * The 25 previously unpassable words from MISSING_WORDS.txt:
 * English nouns, compounds, initialisms, and Korean place/food/person names
 * written in English letters and spoken the English way.
 */
export const TWENTY_FIVE_UNPASSABLE_WORDS = Object.freeze([
  { word: 'andong', target: 'What can we see near Andong?', audio: 'audio/basic_c__unit04__06__what_can_we_see_near_andong.mp3' },
  { word: 'beomjun', target: 'Is Beomjun there?', audio: 'audio/int2c__unit07__02__is_beomjun_there.mp3' },
  { word: 'busan', target: 'What can we see near Busan?', audio: 'audio/basic_c__unit04__02__what_can_we_see_near_busan.mp3' },
  { word: 'ddeok', target: 'Try ddeok', audio: 'audio/int3c__unit01__02__try_ddeok.mp3' },
  { word: 'doenjang', target: 'Try doenjang guk', audio: 'audio/int3c__unit01__05__try_doenjang_guk.mp3' },
  { word: 'durians', target: 'They are durians', audio: 'audio/int3b__unit06__07__they_are_durians.mp3' },
  { word: 'gangwon', target: 'I love winter in Gangwon Province', audio: 'audio/int2c__unit01__07__i_love_winter_in_gangwon_province.mp3' },
  { word: 'gayageum', target: 'It is a gayageum', audio: 'audio/int3b__unit02__08__it_is_a_gayageum.mp3' },
  { word: 'gimbap', target: 'I like gimbap!', audio: 'audio/int3b__unit08__08__i_like_gimbap.mp3' },
  { word: 'gongju', target: 'What can we see near Gongju?', audio: 'audio/basic_c__unit04__05__what_can_we_see_near_gongju.mp3' },
  { word: 'goseong', target: 'What can we see near Goseong?', audio: 'audio/basic_c__unit04__08__what_can_we_see_near_goseong.mp3' },
  { word: 'guk', target: 'Try doenjang guk', audio: 'audio/int3c__unit01__05__try_doenjang_guk.mp3' },
  { word: 'jinhae', target: 'I love spring in Jinhae', audio: 'audio/int2c__unit01__09__i_love_spring_in_jinhae.mp3' },
  { word: 'jjigae', target: 'It is doenjang jjigae', audio: 'audio/int3c__unit01__06__it_is_doenjang_jjigae.mp3' },
  { word: 'lychees', target: 'They are lychees', audio: 'audio/int3b__unit06__03__they_are_lychees.mp3' },
  { word: 'naejangsan', target: 'I love fall in Naejangsan National Park', audio: 'audio/int2c__unit01__05__i_love_fall_in_naejangsan_national_park.mp3' },
  { word: 'nimo', target: 'I love my fish Nimo', audio: 'audio/basic_c__unit01__06__i_love_my_fish_nimo.mp3' },
  { word: 'pyeongchang', target: 'What can we see near Pyeongchang?', audio: 'audio/basic_c__unit04__09__what_can_we_see_near_pyeongchang.mp3' },
  { word: 'rambutans', target: 'They are rambutans', audio: 'audio/int3b__unit06__04__they_are_rambutans.mp3' },
  { word: 'rpg', target: "Let's play an RPG", audio: 'audio/int3c__unit04__09__let_s_play_an_rpg.mp3' },
  { word: 'stingray', target: 'Stingray', audio: 'audio/int3a__unit06__05__stingray.mp3' },
  { word: 'stomachache', target: 'I have a stomachache', audio: 'audio/int2c__unit06__07__i_have_a_stomachache.mp3' },
  { word: 'suncheon', target: 'What can we see near Suncheon?', audio: 'audio/basic_c__unit04__07__what_can_we_see_near_suncheon.mp3' },
  { word: 'taehwan', target: 'Please call his friend Taehwan', audio: 'audio/int2c__unit07__07__please_call_his_friend_taehwan.mp3' },
  { word: 'tongyeong', target: 'What can we see near Tongyeong?', audio: 'audio/basic_c__unit04__04__what_can_we_see_near_tongyeong.mp3' },
]);

function decodeMp3ToFloat32(relPath) {
  const fullPath = join(root, relPath);
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'quiet', '-i', fullPath, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', '16000', 'pipe:1'],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

test('all 25 previously unpassable words get English ARPAbet phonemes without any hand-made override list', () => {
  const cmuJson = JSON.parse(readFileSync(join(root, 'models/cmudict.full.json'), 'utf8'));
  const aidJson = JSON.parse(readFileSync(join(root, 'models/arpabet_to_ids.json'), 'utf8'));
  engine.initG2PFromData(cmuJson, aidJson);

  assert.equal(TWENTY_FIVE_UNPASSABLE_WORDS.length, 25);
  for (const item of TWENTY_FIVE_UNPASSABLE_WORDS) {
    const res = engine.phonesForWord(item.word);
    assert.ok(
      Array.isArray(res.phones) && res.phones.length >= 2,
      `Expected non-empty English ARPAbet phones for "${item.word}", got ${JSON.stringify(res)}`,
    );
    assert.notEqual(res.source, 'override', `"${item.word}" must not come from a hand-made override list`);
    for (const p of res.phones) {
      assert.ok(
        engine.ARPABET_PHONES.includes(p),
        `Invalid ARPAbet phone "${p}" in "${item.word}"`,
      );
    }
  }
});

test('all 25 previously unpassable words pass when spoken the English way through ron-jo/hubert-base-phoneme-en-onnx', async () => {
  const ortCode = readFileSync(join(root, 'vendor/ort/ort.wasm.min.js'), 'utf8');
  const loadOrt = new Function('require', 'exports', 'module', '__filename', '__dirname', `${ortCode}\nreturn ort;`);
  const ort = loadOrt(
    cjsRequire,
    {},
    {},
    join(root, 'vendor/ort/ort.wasm.min.js'),
    join(root, 'vendor/ort'),
  );
  globalThis.ort = ort;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = join(root, 'vendor/ort/');

  const part0 = readFileSync(join(root, 'models/hubert/part-00.bin'));
  const part1 = readFileSync(join(root, 'models/hubert/part-01.bin'));
  const part2 = readFileSync(join(root, 'models/hubert/part-02.bin'));
  const modelBuf = Buffer.concat([part0, part1, part2]);

  const session = await ort.InferenceSession.create(modelBuf, {
    executionProviders: ['wasm'],
  });
  session.ort = ort;
  await trial.initTrialEngine({ session, cachedBytes: modelBuf.byteLength });

  // Cache decoded results by audio path + target so shared recordings run once
  const cache = new Map();
  for (const item of TWENTY_FIVE_UNPASSABLE_WORDS) {
    const key = `${item.audio}::${item.target}`;
    let graded = cache.get(key);
    if (!graded) {
      const samples = decodeMp3ToFloat32(item.audio);
      graded = await trial.gradeTrialSamples(samples, item.target, 60, null, { appId: 'day4' });
      cache.set(key, graded);
    }
    const { result } = graded;
    const wordObj = result.words.find((w) => w.lookup === item.word || w.word.toLowerCase() === item.word);
    assert.ok(wordObj, `Expected word entry for "${item.word}" in "${item.target}"`);
    assert.equal(
      result.acousticFail,
      false,
      `Expected acoustic gate to pass for "${item.word}" (${item.target}), got gate=${JSON.stringify(result.acousticGate)}`,
    );
    assert.equal(
      result.pass,
      true,
      `Expected line "${item.target}" containing "${item.word}" to pass (scorePct=${result.scorePct}, words=${JSON.stringify(result.words.map((w) => [w.word, w.score]))})`,
    );
    assert.ok(
      wordObj.score >= 60,
      `Expected word "${item.word}" score >= 60, got ${wordObj.score}`,
    );
    assert.ok(
      wordObj.band === 'green' || wordObj.band === 'yellow',
      `Expected "${item.word}" band to be green or yellow, got ${wordObj.band}`,
    );
  }
});
