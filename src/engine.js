// MRJ Pronounce — HuBERT CTC Phoneme Pronunciation Engine
// - Full CMUdict (124,926 words) + deterministic English phonics G2P rule fallback
// - Pure sound-only CTC forced-alignment + free phoneme decode acoustic gate
// - Phoneme -> Word -> Line score rollup (never invented, floored, or boosted)
// - Korean-L1 wrong-sound diagnostics (f/p, v/b, r/l, θ/s, ð/d, short vowel swaps,
//   dropped final consonant, added final vowel)
// - Per-app Red / Yellow / Green thresholds

export const MODEL_ID = 'ron-jo/hubert-base-phoneme-en-onnx';
export const BLANK_ID = 40;
export const UNK_ID = 39;
export const VOCAB_SIZE = 43;
export const FRAME_MS = 20;

export const ARPABET_PHONES = Object.freeze([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'B', 'CH', 'D', 'DH',
  'EH', 'ER', 'EY', 'F', 'G', 'HH', 'IH', 'IY', 'JH', 'K',
  'L', 'M', 'N', 'NG', 'OW', 'OY', 'P', 'R', 'S', 'SH',
  'T', 'TH', 'UH', 'UW', 'V', 'W', 'Y', 'Z', 'ZH',
]);

export const PHONE_TO_ID = Object.freeze(
  Object.fromEntries(ARPABET_PHONES.map((p, i) => [p, i])),
);

export const PHONE_IPA_LABEL = Object.freeze({
  AA: '/ɑ/', AE: '/æ/', AH: '/ʌ/', AO: '/ɔ/', AW: '/aʊ/', AY: '/aɪ/',
  B: '/b/', CH: '/tʃ/', D: '/d/', DH: '/ð/', EH: '/ɛ/', ER: '/ɝ/',
  EY: '/eɪ/', F: '/f/', G: '/ɡ/', HH: '/h/', IH: '/ɪ/', IY: '/i/',
  JH: '/dʒ/', K: '/k/', L: '/l/', M: '/m/', N: '/n/', NG: '/ŋ/',
  OW: '/oʊ/', OY: '/ɔɪ/', P: '/p/', R: '/r/', S: '/s/', SH: '/ʃ/',
  T: '/t/', TH: '/θ/', UH: '/ʊ/', UW: '/u/', V: '/v/', W: '/w/',
  Y: '/j/', Z: '/z/', ZH: '/ʒ/',
});

/**
 * Fixed Red / Yellow / Green thresholds per app.
 * - green: solid pass
 * - yellow: 50-74; pass only when the line average is 60+ (PASS_PCT)
 * - red: below yellow; needs retry
 */
export const APP_THRESHOLDS = Object.freeze({
  day4: Object.freeze({ green: 75, yellow: 50 }),
  day6: Object.freeze({ green: 75, yellow: 50 }),
  phonics: Object.freeze({ green: 75, yellow: 50 }),
  decodables: Object.freeze({ green: 75, yellow: 50 }),
  toeic: Object.freeze({ green: 75, yellow: 50 }),
  default: Object.freeze({ green: 75, yellow: 50 }),
});

/** PASS rule (all apps): the line's average score is 60 or more. After 5 tries the student may always move on. */
export const PASS_PCT = 60;

export function getAppThresholds(appId = 'day4') {
  const key = String(appId || 'day4').toLowerCase().trim();
  return APP_THRESHOLDS[key] || APP_THRESHOLDS.default;
}

export function bandForScore(scorePct, appId = 'day4', customThresholds = null) {
  const th = customThresholds || getAppThresholds(appId);
  const pct = Number(scorePct) || 0;
  if (pct >= th.green) return 'green';
  if (pct >= th.yellow) return 'yellow';
  return 'red';
}

// ---------- Text normalization & tokenization ----------
export function normalizeText(text) {
  if (text == null) return '';
  return String(text).trim().replace(/\s+/g, ' ');
}

export function tokenizeWords(text) {
  const out = [];
  const re = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    out.push({
      display: m[0],
      lookup: m[0].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

// ---------- Full CMUdict + Deterministic English Phonics G2P ----------
let _cmudictEntries = null; // compact string map: word -> ASCII chars (65 + phoneIdx) or array
let _arpabetIds = null;

function buildDefaultArpabetIds() {
  const map = {};
  for (let i = 0; i < ARPABET_PHONES.length; i++) {
    map[ARPABET_PHONES[i]] = [i];
  }
  const allophones = {
    AA: ['AA', 'AO', 'AH'],
    AE: ['AE', 'EH', 'AH', 'AA'],
    AH: ['AH', 'IH', 'AA', 'OW', 'UW'],
    AO: ['AO', 'AA', 'OW', 'AH'],
    AW: ['AW', 'OW'],
    AY: ['AY', 'IH'],
    CH: ['CH', 'JH', 'SH'],
    D: ['D', 'T', 'DH'],
    DH: ['DH', 'D'],
    EH: ['EH', 'IH', 'AE', 'AH'],
    ER: ['ER', 'AH', 'R'],
    EY: ['EY', 'EH', 'IY'],
    G: ['G', 'JH', 'K'],
    IH: ['IH', 'IY', 'AH'],
    IY: ['IY', 'IH'],
    JH: ['JH', 'G', 'CH', 'Y'],
    K: ['K', 'G'],
    M: ['M', 'N'],
    N: ['N', 'NG'],
    NG: ['NG', 'N'],
    OW: ['OW', 'AO', 'AH'],
    OY: ['OY', 'AO'],
    R: ['R', 'ER'],
    S: ['S', 'Z'],
    SH: ['SH', 'CH'],
    T: ['T', 'D'],
    UH: ['UH', 'UW', 'AH', 'IH'],
    UW: ['UW', 'UH', 'AH'],
    W: ['W', 'UW', 'UH', 'R'],
    Y: ['Y', 'IY', 'IH'],
    Z: ['Z', 'S'],
    ZH: ['ZH', 'SH', 'JH'],
  };
  for (const [k, list] of Object.entries(allophones)) {
    map[k] = list.map((p) => PHONE_TO_ID[p]);
  }
  return { blank_id: BLANK_ID, phones: ARPABET_PHONES, map };
}

_arpabetIds = buildDefaultArpabetIds();

export function initG2PFromData(cmuData, arpabetIdsData = null) {
  if (cmuData && cmuData.format === 'cmudict-compact-v1' && cmuData.entries) {
    _cmudictEntries = cmuData.entries;
  } else if (cmuData && typeof cmuData === 'object') {
    _cmudictEntries = cmuData;
  }
  if (arpabetIdsData && arpabetIdsData.map) {
    _arpabetIds = arpabetIdsData;
  } else if (!_arpabetIds) {
    _arpabetIds = buildDefaultArpabetIds();
  }
  return {
    words: _cmudictEntries ? Object.keys(_cmudictEntries).length : 0,
    blankId: _arpabetIds.blank_id ?? BLANK_ID,
  };
}

export function isG2PLoaded() {
  return !!_cmudictEntries;
}

export async function loadG2P(baseUrl = '', fetchImpl = fetch) {
  if (_cmudictEntries) {
    return {
      words: Object.keys(_cmudictEntries).length,
      blankId: _arpabetIds.blank_id,
    };
  }
  const [cmuRes, aidRes] = await Promise.all([
    fetchImpl(`${baseUrl}models/cmudict.full.json`),
    fetchImpl(`${baseUrl}models/arpabet_to_ids.json`).catch(() => null),
  ]);
  if (!cmuRes || !cmuRes.ok) {
    throw new Error('Failed to load models/cmudict.full.json');
  }
  const cmuJson = await cmuRes.json();
  const aidJson = aidRes && aidRes.ok ? await aidRes.json() : null;
  return initG2PFromData(cmuJson, aidJson);
}

function decodeCmuEntry(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    const out = new Array(val.length);
    for (let i = 0; i < val.length; i++) {
      out[i] = ARPABET_PHONES[val.charCodeAt(i) - 65] || 'AH';
    }
    return out;
  }
  if (Array.isArray(val)) {
    const raw = Array.isArray(val[0]) ? val[0] : val;
    return raw.map((p) => String(p).replace(/[012]$/, ''));
  }
  return null;
}

function lookupCmu(w) {
  if (!_cmudictEntries) return null;
  return decodeCmuEntry(_cmudictEntries[w]);
}

const LETTER_PHONES = Object.freeze({
  a: ['EY'], b: ['B', 'IY'], c: ['S', 'IY'], d: ['D', 'IY'], e: ['IY'],
  f: ['EH', 'F'], g: ['JH', 'IY'], h: ['EY', 'CH'], i: ['AY'], j: ['JH', 'EY'],
  k: ['K', 'EY'], l: ['EH', 'L'], m: ['EH', 'M'], n: ['EH', 'N'], o: ['OW'],
  p: ['P', 'IY'], q: ['K', 'Y', 'UW'], r: ['AA', 'R'], s: ['EH', 'S'], t: ['T', 'IY'],
  u: ['Y', 'UW'], v: ['V', 'IY'], w: ['D', 'AH', 'B', 'AH', 'L', 'Y', 'UW'],
  x: ['EH', 'K', 'S'], y: ['W', 'AY'], z: ['Z', 'IY'],
});

const NUMBER_WORDS_SMALL = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const NUMBER_WORDS_TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

function numberToEnglishWords(n) {
  if (!Number.isFinite(n) || n < 0) return ['zero'];
  if (n < 20) return [NUMBER_WORDS_SMALL[n]];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r ? [NUMBER_WORDS_TENS[t], NUMBER_WORDS_SMALL[r]] : [NUMBER_WORDS_TENS[t]];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const head = [NUMBER_WORDS_SMALL[h], 'hundred'];
    return r ? head.concat(numberToEnglishWords(r)) : head;
  }
  if (n < 10000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const head = [NUMBER_WORDS_SMALL[th], 'thousand'];
    return r ? head.concat(numberToEnglishWords(r)) : head;
  }
  return String(n).split('').map((d) => NUMBER_WORDS_SMALL[Number(d)] || 'zero');
}

function isVowelChar(ch) {
  return ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u' || ch === 'y';
}

const VOICELESS_FINALS = new Set(['P', 'T', 'K', 'F', 'TH', 'S', 'SH', 'CH']);
const SIBILANT_FINALS = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);

function appendPluralPhones(stemPhones) {
  if (!stemPhones || !stemPhones.length) return ['Z'];
  const last = stemPhones[stemPhones.length - 1];
  if (SIBILANT_FINALS.has(last)) return [...stemPhones, 'IH', 'Z'];
  if (VOICELESS_FINALS.has(last)) return [...stemPhones, 'S'];
  return [...stemPhones, 'Z'];
}

function appendPastPhones(stemPhones) {
  if (!stemPhones || !stemPhones.length) return ['D'];
  const last = stemPhones[stemPhones.length - 1];
  if (last === 'T' || last === 'D') return [...stemPhones, 'IH', 'D'];
  if (VOICELESS_FINALS.has(last)) return [...stemPhones, 'T'];
  return [...stemPhones, 'D'];
}

/**
 * Deterministic English phonics Grapheme-to-Phoneme (G2P) rule engine.
 * Converts ANY word written in English letters into English ARPAbet phonemes,
 * including compound words, inflections, initialisms, and romanized names.
 */
export function g2pEnglishPhonics(rawWord) {
  const clean = String(rawWord || '').toLowerCase().replace(/[^a-z0-9']/g, '');
  if (!clean) return { phones: [], source: 'empty' };

  // 1. Pure number token
  if (/^\d+$/.test(clean)) {
    const words = numberToEnglishWords( parseInt(clean, 10) );
    const ph = [];
    for (const nw of words) {
      const c = lookupCmu(nw) || g2pGraphemeRules(nw);
      ph.push(...c);
    }
    return { phones: ph, source: 'number' };
  }

  const alpha = clean.replace(/^'+|'+$/g, '');
  if (!alpha) return { phones: [], source: 'empty' };

  // 2. Direct CMUdict lookup
  const direct = lookupCmu(alpha);
  if (direct) return { phones: direct, source: 'cmudict' };

  // 3. Contraction / possessive handling (e.g. "let's", "janitor's")
  if (alpha.includes("'")) {
    const [stem, tail] = alpha.split("'");
    const stemPh = lookupCmu(stem) || g2pEnglishPhonics(stem).phones;
    if (tail === 's' && stemPh.length) {
      return { phones: appendPluralPhones(stemPh), source: 'inflected' };
    }
    if (tail === 't' && stemPh.length) {
      return { phones: [...stemPh, 'T'], source: 'inflected' };
    }
    if (tail === 'll' && stemPh.length) {
      return { phones: [...stemPh, 'L'], source: 'inflected' };
    }
  }

  // 4. Vowelless initialism (e.g. "rpg", "tv", "cm", "dj")
  const hasVowel = /[aeiouy]/.test(alpha);
  if (!hasVowel && alpha.length <= 5) {
    const ph = [];
    for (const ch of alpha) {
      if (LETTER_PHONES[ch]) ph.push(...LETTER_PHONES[ch]);
    }
    if (ph.length) return { phones: ph, source: 'initialism' };
  }

  // 5. Compound split into two CMUdict words (e.g. "stingray", "stomachache")
  if (alpha.length >= 6 && _cmudictEntries) {
    for (let split = 3; split <= alpha.length - 3; split++) {
      const left = alpha.slice(0, split);
      const right = alpha.slice(split);
      const lPh = lookupCmu(left);
      const rPh = lookupCmu(right);
      if (lPh && rPh) {
        return { phones: [...lPh, ...rPh], source: 'compound' };
      }
    }
  }

  // 6. Regular English plural / inflection on CMUdict stem or phonics stem
  if (alpha.endsWith('ies') && alpha.length > 4) {
    const stemY = alpha.slice(0, -3) + 'y';
    const cmuY = lookupCmu(stemY);
    if (cmuY) return { phones: appendPluralPhones(cmuY), source: 'inflected' };
  }
  if (alpha.endsWith('es') && alpha.length > 4) {
    const stem1 = alpha.slice(0, -1); // e.g. lychees -> lychee
    const cmu1 = lookupCmu(stem1);
    if (cmu1) return { phones: appendPluralPhones(cmu1), source: 'inflected' };
    const stem2 = alpha.slice(0, -2);
    const cmu2 = lookupCmu(stem2);
    if (cmu2) return { phones: appendPluralPhones(cmu2), source: 'inflected' };
  }
  if (alpha.endsWith('s') && !alpha.endsWith('ss') && !alpha.endsWith('us') && alpha.length > 3) {
    const stem = alpha.slice(0, -1);
    const cmuStem = lookupCmu(stem);
    if (cmuStem) return { phones: appendPluralPhones(cmuStem), source: 'inflected' };
    const ruleStem = g2pGraphemeRules(stem);
    if (ruleStem.length) return { phones: appendPluralPhones(ruleStem), source: 'phonics_g2p' };
  }
  if (alpha.endsWith('ed') && alpha.length > 4) {
    const stem1 = alpha.slice(0, -1);
    const cmu1 = lookupCmu(stem1);
    if (cmu1) return { phones: appendPastPhones(cmu1), source: 'inflected' };
    const stem2 = alpha.slice(0, -2);
    const cmu2 = lookupCmu(stem2);
    if (cmu2) return { phones: appendPastPhones(cmu2), source: 'inflected' };
  }
  if (alpha.endsWith('ing') && alpha.length > 5) {
    const stem = alpha.slice(0, -3);
    const cmuStem = lookupCmu(stem) || lookupCmu(stem + 'e');
    if (cmuStem) return { phones: [...cmuStem, 'IH', 'NG'], source: 'inflected' };
  }

  // 7. Pure grapheme-to-phoneme English phonics rules
  return { phones: g2pGraphemeRules(alpha), source: 'phonics_g2p' };
}

function g2pGraphemeRules(w) {
  const s = w.replace(/[^a-z]/g, '');
  if (!s) return [];
  const n = s.length;
  const out = [];
  let i = 0;

  // Detect magic-e (VCe at end of word, e.g. "make", "cute")
  const hasMagicE =
    n >= 4 &&
    s[n - 1] === 'e' &&
    !isVowelChar(s[n - 2]) &&
    isVowelChar(s[n - 3]) &&
    !isVowelChar(s[n - 4]);

  while (i < n) {
    const rem = s.slice(i);

    // Multi-letter patterns (longest match first)
    if (rem.startsWith('yeong')) { out.push('Y', 'AH', 'NG'); i += 5; continue; }
    if (rem.startsWith('tion') || rem.startsWith('sion')) {
      out.push('SH', 'AH', 'N');
      i += 4;
      continue;
    }
    if (rem.startsWith('eong')) { out.push('AH', 'NG'); i += 4; continue; }
    if (rem.startsWith('tch')) { out.push('CH'); i += 3; continue; }
    if (rem.startsWith('dge')) { out.push('JH'); i += 3; continue; }
    if (rem.startsWith('igh')) { out.push('AY'); i += 3; continue; }
    if (rem.startsWith('hae') && i + 3 === n) { out.push('HH', 'EY'); i += 3; continue; }
    if (rem.startsWith('gae') && i + 3 === n) { out.push('G', 'EY'); i += 3; continue; }
    if (rem.startsWith('eum')) { out.push('EH', 'M'); i += 3; continue; }
    if (rem.startsWith('eon')) { out.push('AH', 'N'); i += 3; continue; }
    if (rem.startsWith('eok')) { out.push('AH', 'K'); i += 3; continue; }
    if (rem.startsWith('eom')) { out.push('AH', 'M'); i += 3; continue; }
    if (rem.startsWith('oen')) { out.push('W', 'EH', 'N'); i += 3; continue; }
    if (rem.startsWith('ang')) { out.push('AE', 'NG'); i += 3; continue; }
    if (rem.startsWith('ing')) { out.push('IH', 'NG'); i += 3; continue; }
    if (rem.startsWith('ong')) { out.push('AO', 'NG'); i += 3; continue; }
    if (rem.startsWith('ung')) { out.push('AH', 'NG'); i += 3; continue; }
    if (rem.startsWith('ian')) { out.push('IY', 'AH', 'N'); i += 3; continue; }

    // Consonant digraphs & doubled consonants
    if (rem.startsWith('ch')) { out.push('CH'); i += 2; continue; }
    if (rem.startsWith('sh')) { out.push('SH'); i += 2; continue; }
    if (rem.startsWith('th')) { out.push('TH'); i += 2; continue; }
    if (rem.startsWith('ph')) { out.push('F'); i += 2; continue; }
    if (rem.startsWith('wh')) { out.push('W'); i += 2; continue; }
    if (rem.startsWith('ck')) { out.push('K'); i += 2; continue; }
    if (rem.startsWith('ng')) { out.push('NG'); i += 2; continue; }
    if (rem.startsWith('nk')) { out.push('NG', 'K'); i += 2; continue; }
    if (rem.startsWith('qu')) { out.push('K', 'W'); i += 2; continue; }
    if (i === 0 && (rem.startsWith('kn') || rem.startsWith('gn'))) { out.push('N'); i += 2; continue; }
    if (i === 0 && rem.startsWith('wr')) { out.push('R'); i += 2; continue; }

    if (rem.startsWith('dd')) { out.push('D'); i += 2; continue; }
    if (rem.startsWith('jj')) { out.push('JH'); i += 2; continue; }
    if (rem.startsWith('kk')) { out.push('K'); i += 2; continue; }
    if (rem.startsWith('pp')) { out.push('P'); i += 2; continue; }
    if (rem.startsWith('ss')) { out.push('S'); i += 2; continue; }
    if (rem.startsWith('tt')) { out.push('T'); i += 2; continue; }
    if (rem.startsWith('bb')) { out.push('B'); i += 2; continue; }
    if (rem.startsWith('ff')) { out.push('F'); i += 2; continue; }
    if (rem.startsWith('gg')) { out.push('G'); i += 2; continue; }
    if (rem.startsWith('ll')) { out.push('L'); i += 2; continue; }
    if (rem.startsWith('mm')) { out.push('M'); i += 2; continue; }
    if (rem.startsWith('nn')) { out.push('N'); i += 2; continue; }
    if (rem.startsWith('rr')) { out.push('R'); i += 2; continue; }
    if (rem.startsWith('zz')) { out.push('Z'); i += 2; continue; }

    // Vowel digraphs & r-controlled vowels
    if (rem.startsWith('ee') || rem.startsWith('ea')) { out.push('IY'); i += 2; continue; }
    if (rem.startsWith('oo')) { out.push('UW'); i += 2; continue; }
    if (rem.startsWith('ai') || rem.startsWith('ay') || rem.startsWith('ae')) { out.push('EY'); i += 2; continue; }
    if (rem.startsWith('oi') || rem.startsWith('oy')) { out.push('OY'); i += 2; continue; }
    if (rem.startsWith('ou') || rem.startsWith('ow')) {
      out.push(i + 2 === n && rem.startsWith('ow') ? 'OW' : 'AW');
      i += 2;
      continue;
    }
    if (rem.startsWith('au') || rem.startsWith('aw')) { out.push('AO'); i += 2; continue; }
    if (rem.startsWith('oa') || rem.startsWith('oe')) { out.push('OW'); i += 2; continue; }
    if (rem.startsWith('ie')) { out.push(i + 2 === n ? 'AY' : 'IY'); i += 2; continue; }
    if (rem.startsWith('ei') || rem.startsWith('ey')) { out.push('EY'); i += 2; continue; }
    if (rem.startsWith('eu') || rem.startsWith('ew')) { out.push('UW'); i += 2; continue; }
    if (rem.startsWith('eo')) { out.push('AH'); i += 2; continue; }

    // R-controlled vowels when not followed by another vowel
    if (rem.startsWith('ar') && !isVowelChar(s[i + 2])) { out.push('AA', 'R'); i += 2; continue; }
    if (rem.startsWith('or') && !isVowelChar(s[i + 2])) { out.push('AO', 'R'); i += 2; continue; }
    if ((rem.startsWith('er') || rem.startsWith('ir') || rem.startsWith('ur')) && !isVowelChar(s[i + 2])) {
      out.push('ER');
      i += 2;
      continue;
    }

    const ch = s[i];
    const next = s[i + 1] || '';

    // Single vowels
    if (ch === 'a') {
      if (hasMagicE && i === n - 3) out.push('EY');
      else if (next === 'w' || next === 'l') out.push('AO');
      else if (i === n - 1) out.push('AH');
      else out.push('AE');
      i++;
      continue;
    }
    if (ch === 'e') {
      if (i === n - 1 && n > 2 && out.length > 0) {
        // Silent final 'e' in English phonics
        i++;
        continue;
      }
      if (hasMagicE && i === n - 3) out.push('IY');
      else out.push('EH');
      i++;
      continue;
    }
    if (ch === 'i') {
      if (hasMagicE && i === n - 3) out.push('AY');
      else if (i === n - 1) out.push('IY');
      else out.push('IH');
      i++;
      continue;
    }
    if (ch === 'o') {
      if (hasMagicE && i === n - 3) out.push('OW');
      else if (i === n - 1) out.push('OW');
      else out.push('AA');
      i++;
      continue;
    }
    if (ch === 'u') {
      if (hasMagicE && i === n - 3) out.push('UW');
      else if (i === n - 1) out.push('UW');
      else out.push('AH');
      i++;
      continue;
    }
    if (ch === 'y') {
      if (i === 0 || isVowelChar(next)) out.push('Y');
      else if (i === n - 1 && n <= 3) out.push('AY');
      else out.push('IY');
      i++;
      continue;
    }

    // Single consonants
    switch (ch) {
      case 'b': out.push('B'); break;
      case 'c':
        if (next === 'e' || next === 'i' || next === 'y') out.push('S');
        else out.push('K');
        break;
      case 'd': out.push('D'); break;
      case 'f': out.push('F'); break;
      case 'g':
        if (i > 0 && (next === 'e' || next === 'i' || next === 'y')) out.push('JH');
        else out.push('G');
        break;
      case 'h':
        if (i === 0 || isVowelChar(next)) out.push('HH');
        break;
      case 'j': out.push('JH'); break;
      case 'k': out.push('K'); break;
      case 'l': out.push('L'); break;
      case 'm': out.push('M'); break;
      case 'n': out.push('N'); break;
      case 'p': out.push('P'); break;
      case 'q': out.push('K'); break;
      case 'r': out.push('R'); break;
      case 's':
        if (i === n - 1 && i > 0 && isVowelChar(s[i - 1])) out.push('Z');
        else out.push('S');
        break;
      case 't': out.push('T'); break;
      case 'v': out.push('V'); break;
      case 'w': out.push('W'); break;
      case 'x': out.push('K', 'S'); break;
      case 'z': out.push('Z'); break;
      default: break;
    }
    i++;
  }

  // Deduplicate adjacent identical phonemes from cluster boundaries
  const dedup = [];
  for (const p of out) {
    if (!dedup.length || dedup[dedup.length - 1] !== p) dedup.push(p);
  }
  return dedup.length ? dedup : ['AH'];
}

export function phonesForWord(word) {
  const res = g2pEnglishPhonics(word);
  return {
    word: String(word || '').toLowerCase(),
    phones: res.phones,
    source: res.source,
  };
}

/**
 * With full CMUdict + English phonics G2P fallback, any word written in English letters
 * receives a valid English pronunciation, so unknownWords is empty.
 */
export function unknownWords(text) {
  return tokenizeWords(normalizeText(text))
    .filter((t) => phonesForWord(t.lookup).phones.length === 0)
    .map((t) => t.lookup);
}

export function expectedPhoneSequence(text) {
  const toks = tokenizeWords(normalizeText(text));
  const words = toks.map((t) => {
    const p = phonesForWord(t.lookup);
    return {
      word: t.lookup,
      display: t.display,
      phones: p.phones,
      source: p.source,
    };
  });
  const phones = [];
  for (const w of words) phones.push(...w.phones);
  return { phones, words };
}

export function dictionaryCoverage(text) {
  const toks = tokenizeWords(normalizeText(text));
  if (!toks.length) return 0;
  let covered = 0;
  for (const t of toks) {
    if (phonesForWord(t.lookup).phones.length > 0) covered++;
  }
  return covered / toks.length;
}

// ---------- Korean-L1 Wrong-Sound Alternatives & Diagnostics ----------
const VOWEL_SET = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);

const FINAL_CONSONANT_SET = new Set([
  'P', 'T', 'K', 'B', 'D', 'G', 'F', 'V', 'TH', 'DH', 'S', 'Z', 'SH', 'CH', 'JH', 'M', 'N', 'NG', 'L',
]);

/**
 * Known Korean-L1 phoneme substitution patterns:
 * f/p, v/b, r/l, θ/s, ð/d, short vowel swaps, dropped final consonant, added final vowel.
 */
export const KOREAN_L1_ALTERNATIVES = Object.freeze({
  F: Object.freeze({
    P: { pattern: 'f_to_p', label: 'Heard /p/ instead of /f/ (touch upper teeth to lower lip for f)' },
    B: { pattern: 'f_to_p', label: 'Heard /b/ instead of /f/ (blow air softly through teeth and lip)' },
  }),
  V: Object.freeze({
    B: { pattern: 'v_to_b', label: 'Heard /b/ instead of /v/ (keep upper teeth on lower lip for v)' },
    P: { pattern: 'v_to_b', label: 'Heard /p/ instead of /v/ (voice with teeth on lower lip)' },
  }),
  R: Object.freeze({
    L: { pattern: 'r_to_l', label: 'Heard /l/ instead of /r/ (curl tongue back without touching roof)' },
  }),
  L: Object.freeze({
    R: { pattern: 'l_to_r', label: 'Heard /r/ instead of /l/ (touch tongue tip behind upper teeth)' },
  }),
  TH: Object.freeze({
    S: { pattern: 'th_to_s', label: 'Heard /s/ instead of /θ/ (put tongue tip lightly between teeth)' },
    T: { pattern: 'th_to_t', label: 'Heard /t/ instead of /θ/ (blow air over tongue between teeth)' },
    F: { pattern: 'th_to_f', label: 'Heard /f/ instead of /θ/ (use tongue between teeth, not lip)' },
  }),
  DH: Object.freeze({
    D: { pattern: 'dh_to_d', label: 'Heard /d/ instead of /ð/ (keep tongue tip between teeth)' },
    Z: { pattern: 'dh_to_z', label: 'Heard /z/ instead of /ð/ (put tongue tip between teeth)' },
    V: { pattern: 'dh_to_v', label: 'Heard /v/ instead of /ð/' },
  }),
  Z: Object.freeze({
    JH: { pattern: 'z_to_jh', label: 'Heard /dʒ/ (ㅈ) instead of /z/ (buzz behind teeth)' },
    S: { pattern: 'z_to_s', label: 'Heard unvoiced /s/ instead of voiced /z/' },
  }),
  SH: Object.freeze({
    S: { pattern: 'sh_to_s', label: 'Heard /s/ instead of /ʃ/ (round lips slightly for sh)' },
  }),
  AE: Object.freeze({
    EH: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /ɛ/ (bed) instead of /æ/ (cat)' },
    AA: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /ɑ/ instead of /æ/' },
  }),
  EH: Object.freeze({
    AE: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /æ/ (cat) instead of /ɛ/ (bed)' },
    IH: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /ɪ/ instead of /ɛ/' },
  }),
  IH: Object.freeze({
    IY: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard tense /i/ (seat) instead of short /ɪ/ (sit)' },
    EH: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /ɛ/ instead of /ɪ/' },
  }),
  IY: Object.freeze({
    IH: { pattern: 'short_vowel_swap', label: 'Vowel swap: heard short /ɪ/ instead of long /i/' },
  }),
  UH: Object.freeze({
    UW: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard long /u/ instead of short /ʊ/ (book)' },
    AH: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /ʌ/ instead of /ʊ/' },
  }),
  UW: Object.freeze({
    UH: { pattern: 'short_vowel_swap', label: 'Vowel swap: heard short /ʊ/ instead of /u/' },
  }),
  AH: Object.freeze({
    AA: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /ɑ/ instead of /ʌ/' },
    AO: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /ɔ/ instead of /ʌ/' },
  }),
  AA: Object.freeze({
    AH: { pattern: 'short_vowel_swap', label: 'Short vowel swap: heard /ʌ/ instead of open /ɑ/' },
    OW: { pattern: 'short_vowel_swap', label: 'Vowel swap: heard /oʊ/ instead of /ɑ/' },
  }),
});

/**
 * Inspect aligned frames (and trailing frames for word-final consonants) to
 * diagnose what sound was actually heard, with explicit Korean-L1 pattern matching.
 */
export function diagnoseKoreanL1Phoneme({
  expectedPhone,
  scorePct,
  frames,
  nbProbs,
  rawProbs,
  isWordFinal,
  nextWordStartFrame,
  totalFrames,
}) {
  const expId = PHONE_TO_ID[expectedPhone];
  // 1. Dropped final consonant check
  if (isWordFinal && FINAL_CONSONANT_SET.has(expectedPhone)) {
    let maxTargetProb = 0;
    if (frames && frames.length && expId != null) {
      for (const f of frames) {
        if (rawProbs[f][expId] > maxTargetProb) maxTargetProb = rawProbs[f][expId];
      }
    }
    if (!frames || !frames.length || (scorePct < 55 && maxTargetProb < 0.04)) {
      return {
        heardPhone: null,
        l1Pattern: 'dropped_final_consonant',
        feedback: `Dropped final ${PHONE_IPA_LABEL[expectedPhone] || expectedPhone} sound`,
      };
    }
  }

  // Find dominant non-blank phoneme heard across the aligned frames
  let dominantPhone = expectedPhone;
  let dominantAvg = 0;
  if (frames && frames.length && nbProbs && nbProbs.length) {
    const sums = new Float64Array(ARPABET_PHONES.length);
    for (const f of frames) {
      const row = nbProbs[f];
      for (let j = 0; j < ARPABET_PHONES.length; j++) sums[j] += row[j];
    }
    let bestJ = expId ?? 0;
    let bestVal = -1;
    for (let j = 0; j < ARPABET_PHONES.length; j++) {
      if (sums[j] > bestVal) {
        bestVal = sums[j];
        bestJ = j;
      }
    }
    dominantPhone = ARPABET_PHONES[bestJ];
    dominantAvg = bestVal / frames.length;
  }

  // 2. Added final vowel (Korean epenthetic '으/이' vowel after a word-final consonant)
  if (isWordFinal && FINAL_CONSONANT_SET.has(expectedPhone) && frames && frames.length) {
    const lastConsFrame = frames[frames.length - 1];
    const searchEnd = Math.min(
      totalFrames,
      nextWordStartFrame != null ? nextWordStartFrame : lastConsFrame + 5,
      lastConsFrame + 5,
    );
    const epentheticVowels = ['AH', 'UH', 'UW', 'IH', 'IY'];
    for (let f = lastConsFrame; f < searchEnd; f++) {
      // Only check frames after the consonant's peak frame
      if (f === frames[0] && frames.length === 1) continue;
      const rRow = rawProbs[f];
      const nbRow = nbProbs[f];
      for (const v of epentheticVowels) {
        const vid = PHONE_TO_ID[v];
        if (rRow[vid] > 0.22 && nbRow[vid] > 0.45 && nbRow[vid] > nbRow[expId] * 1.5) {
          return {
            heardPhone: v,
            l1Pattern: 'added_final_vowel',
            feedback: `Added extra vowel ${PHONE_IPA_LABEL[v]} after final ${PHONE_IPA_LABEL[expectedPhone]}`,
          };
        }
      }
    }
  }

  // 3. Specific Korean-L1 substitution table (f/p, v/b, r/l, θ/s, ð/d, short vowel swaps)
  if (scorePct < 80 && dominantPhone !== expectedPhone) {
    const table = KOREAN_L1_ALTERNATIVES[expectedPhone];
    if (table && table[dominantPhone]) {
      return {
        heardPhone: dominantPhone,
        l1Pattern: table[dominantPhone].pattern,
        feedback: table[dominantPhone].label,
      };
    }
    if (scorePct < 65 && dominantAvg > 0.25) {
      return {
        heardPhone: dominantPhone,
        l1Pattern: VOWEL_SET.has(expectedPhone) && VOWEL_SET.has(dominantPhone)
          ? 'short_vowel_swap'
          : 'sound_substitution',
        feedback: `Heard ${PHONE_IPA_LABEL[dominantPhone] || dominantPhone} instead of ${PHONE_IPA_LABEL[expectedPhone] || expectedPhone}`,
      };
    }
  }

  return {
    heardPhone: expectedPhone,
    l1Pattern: null,
    feedback: '',
  };
}

// ---------- CTC Log-Softmax, Viterbi Forced Alignment & Free Phoneme Decode ----------
const NEG_INF = -1e30;

export function logSoftmax2D(logits) {
  const T = logits.length;
  if (!T) return [];
  const V = logits[0].length;
  const out = new Array(T);
  for (let t = 0; t < T; t++) {
    const row = logits[t];
    let m = -Infinity;
    for (let j = 0; j < V; j++) if (row[j] > m) m = row[j];
    let sum = 0;
    const lrow = new Float64Array(V);
    for (let j = 0; j < V; j++) {
      const e = Math.exp(row[j] - m);
      lrow[j] = e;
      sum += e;
    }
    const lse = m + Math.log(sum + 1e-12);
    for (let j = 0; j < V; j++) lrow[j] = row[j] - lse;
    out[t] = lrow;
  }
  return out;
}

/**
 * Convert flat Float32Array [T * V] or 2D array into 2D array [T][V].
 */
export function unflattenLogits(logitsOrFlat, timeSteps, vocab = VOCAB_SIZE) {
  if (Array.isArray(logitsOrFlat)) return logitsOrFlat;
  const T = timeSteps || Math.floor(logitsOrFlat.length / vocab);
  const out = new Array(T);
  for (let t = 0; t < T; t++) {
    out[t] = logitsOrFlat.subarray(t * vocab, (t + 1) * vocab);
  }
  return out;
}

function computeBiasedLogProbsAndPosteriors(logits2D, blankId = BLANK_ID, blankBias = -2.0) {
  const T = logits2D.length;
  const V = T ? logits2D[0].length : VOCAB_SIZE;
  const rawProbs = new Array(T);
  const biasedLogProbs = new Array(T);
  const nbProbs = new Array(T);
  const numPhones = Math.min(ARPABET_PHONES.length, V);

  for (let t = 0; t < T; t++) {
    const row = logits2D[t];
    // Raw probabilities
    let mRaw = -Infinity;
    for (let j = 0; j < V; j++) if (row[j] > mRaw) mRaw = row[j];
    let sumRaw = 0;
    const pRaw = new Float64Array(V);
    for (let j = 0; j < V; j++) {
      const e = Math.exp(row[j] - mRaw);
      pRaw[j] = e;
      sumRaw += e;
    }
    for (let j = 0; j < V; j++) pRaw[j] /= sumRaw + 1e-12;
    rawProbs[t] = pRaw;

    // Non-blank 39-phoneme posteriors
    let sumNb = 0;
    const pNb = new Float64Array(numPhones);
    for (let j = 0; j < numPhones; j++) {
      pNb[j] = pRaw[j];
      sumNb += pRaw[j];
    }
    const invNb = 1 / (sumNb + 1e-12);
    for (let j = 0; j < numPhones; j++) pNb[j] *= invNb;
    nbProbs[t] = pNb;

    // Blank-discounted log-probabilities for CTC Viterbi alignment and free decode
    let mBias = -Infinity;
    const bRow = new Float64Array(V);
    for (let j = 0; j < V; j++) {
      const v = j === blankId ? row[j] + blankBias : row[j];
      bRow[j] = v;
      if (v > mBias) mBias = v;
    }
    let sumBias = 0;
    for (let j = 0; j < V; j++) sumBias += Math.exp(bRow[j] - mBias);
    const lseBias = mBias + Math.log(sumBias + 1e-12);
    for (let j = 0; j < V; j++) bRow[j] -= lseBias;
    biasedLogProbs[t] = bRow;
  }

  return { rawProbs, nbProbs, biasedLogProbs };
}

/**
 * Free phoneme decode (unconstrained acoustic likelihood + decoded phone sequence).
 * Used ONLY for the acoustic likelihood ratio gate (alignLL - freeLL) and L1 diagnostics,
 * NEVER for text string matching.
 */
export function freePhonemeDecode(biasedLogProbs, rawProbs, blankId = BLANK_ID) {
  const T = biasedLogProbs.length;
  if (!T) return { freeLLPerFrame: 0, decodedPhones: [], nonBlankFrameRatio: 0 };
  const numPhones = ARPABET_PHONES.length;
  let totalLL = 0;
  let prev = -1;
  const decodedPhones = [];
  let nonBlankFrames = 0;

  for (let t = 0; t < T; t++) {
    const row = biasedLogProbs[t];
    let bestId = blankId;
    let bestVal = row[blankId] ?? NEG_INF;
    for (let j = 0; j < numPhones; j++) {
      if (row[j] > bestVal) {
        bestVal = row[j];
        bestId = j;
      }
    }
    totalLL += bestVal;
    if (bestId !== blankId) {
      nonBlankFrames++;
      if (bestId !== prev && bestId < numPhones) {
        decodedPhones.push(ARPABET_PHONES[bestId]);
      }
    }
    prev = bestId;
  }

  return {
    freeLLPerFrame: totalLL / T,
    decodedPhones,
    nonBlankFrameRatio: nonBlankFrames / T,
  };
}

function expandedStates(primIds) {
  const out = [];
  for (const p of primIds) {
    out.push(null);
    out.push(p);
  }
  out.push(null);
  return out;
}

function runCtcViterbi(trellisLogP, states, blankId) {
  const T = trellisLogP.length;
  const S = states.length;
  const stateVocab = states.map((s) => (s === null ? blankId : s));
  const logV = new Array(T);
  const back = new Array(T);
  for (let t = 0; t < T; t++) {
    logV[t] = new Float64Array(S).fill(NEG_INF);
    back[t] = new Int32Array(S);
  }
  logV[0][0] = trellisLogP[0][stateVocab[0]];
  if (S > 1) logV[0][1] = trellisLogP[0][stateVocab[1]];

  for (let t = 1; t < T; t++) {
    const vPrev = logV[t - 1];
    const curV = logV[t];
    const curBack = back[t];
    const row = trellisLogP[t];
    for (let s = 0; s < S; s++) {
      let best = s;
      let bestVal = vPrev[s];
      if (s >= 1 && vPrev[s - 1] > bestVal) {
        best = s - 1;
        bestVal = vPrev[s - 1];
      }
      if (s >= 2 && states[s] !== null && states[s] !== states[s - 2] && vPrev[s - 2] > bestVal) {
        best = s - 2;
        bestVal = vPrev[s - 2];
      }
      curV[s] = bestVal + row[stateVocab[s]];
      curBack[s] = best;
    }
  }

  // Allow ending in final blank (S - 1) or final phoneme state (S - 2)
  const maxReach = Math.min(S - 1, 1 + 2 * (T - 1));
  let endS = maxReach;
  if (maxReach >= 1 && logV[T - 1][maxReach - 1] > logV[T - 1][maxReach]) {
    endS = maxReach - 1;
  }
  const finalLL = logV[T - 1][endS];
  const path = new Int32Array(T);
  let s = endS;
  path[T - 1] = s;
  for (let t = T - 1; t > 0; t--) {
    s = back[t][s];
    path[t - 1] = s;
  }
  return { path, alignLLPerFrame: finalLL / T };
}

/**
 * Core CTC forced-alignment Goodness of Pronunciation (GOP) per expected phoneme.
 * Returns phoneme-level objects with raw 0..1 score, 0..100 scorePct, frame spans,
 * and acoustic alignment likelihood.
 */
export function forcedAlignGop(logits, expectedPhones, blankId = BLANK_ID, opts = {}) {
  const logits2D = unflattenLogits(logits);
  const T = logits2D.length;
  if (T === 0) {
    return expectedPhones.map((p) => ({
      phone: p,
      score: 0,
      scorePct: 0,
      status: 'del',
      startFrame: null,
      endFrame: null,
      heardPhone: null,
      l1Pattern: null,
      feedback: '',
    }));
  }
  if (!expectedPhones.length) return [];

  const V = logits2D[0].length;
  const numPhones = Math.min(ARPABET_PHONES.length, V);
  const blankBias = typeof opts.blankBias === 'number'
    ? opts.blankBias
    : (blankId === BLANK_ID ? -2.0 : 0);

  const { rawProbs, nbProbs, biasedLogProbs } = computeBiasedLogProbsAndPosteriors(
    logits2D,
    blankId,
    blankBias,
  );

  const aidMap = (_arpabetIds && _arpabetIds.map) || buildDefaultArpabetIds().map;
  const strictPhonics = opts.appId === 'phonics';
  const cands = expectedPhones.map((p) => {
    const ids = aidMap[p] || (PHONE_TO_ID[p] != null ? [PHONE_TO_ID[p]] : []);
    const valid = ids.filter((id) => id !== blankId && id >= 0 && id < V);
    return strictPhonics ? valid.slice(0, 1) : valid;
  });

  const primIds = cands.map((c, idx) => (c.length ? c[0] : (PHONE_TO_ID[expectedPhones[idx]] ?? 0)));
  const states = expandedStates(primIds);

  // Build state-specific emission trellis so allophone sets for a phoneme do not
  // overwrite the emission log-prob of a different phoneme sharing the same token ID.
  const trellisLogP = biasedLogProbs.map((row) => Float64Array.from(row));
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.length > 1) {
      const prim = primIds[i];
      for (let t = 0; t < T; t++) {
        let mx = biasedLogProbs[t][c[0]];
        for (let k = 1; k < c.length; k++) {
          // Discount secondary allophones slightly (-0.35) so primary phone is preferred
          const v = biasedLogProbs[t][c[k]] - 0.35;
          if (v > mx) mx = v;
        }
        if (mx > trellisLogP[t][prim]) trellisLogP[t][prim] = mx;
      }
    }
  }

  const { path, alignLLPerFrame } = T === 1
    ? { path: Int32Array.from([states.length > 1 ? 1 : 0]), alignLLPerFrame: trellisLogP[0][primIds[0]] || 0 }
    : runCtcViterbi(trellisLogP, states, blankId);

  const wordFinalIndices = opts.wordFinalIndices || new Set();
  const framesByPhone = new Array(expectedPhones.length);
  for (let i = 0; i < expectedPhones.length; i++) {
    const stateIdx = 2 * i + 1;
    const frames = [];
    for (let t = 0; t < T; t++) {
      if (path[t] === stateIdx) frames.push(t);
    }
    framesByPhone[i] = frames;
  }

  const out = [];
  for (let i = 0; i < expectedPhones.length; i++) {
    const phone = expectedPhones[i];
    const frames = framesByPhone[i];
    const pids = cands[i];
    const isWordFinal = wordFinalIndices.has(i);
    const nextFrames = i + 1 < expectedPhones.length ? framesByPhone[i + 1] : null;
    const nextStart = nextFrames && nextFrames.length ? nextFrames[0] : null;

    if (!frames.length || !pids.length) {
      const diag = diagnoseKoreanL1Phoneme({
        expectedPhone: phone,
        scorePct: 0,
        frames: [],
        nbProbs,
        rawProbs,
        isWordFinal,
        nextWordStartFrame: nextStart,
        totalFrames: T,
      });
      out.push({
        phone,
        score: 0,
        scorePct: 0,
        status: 'del',
        startFrame: null,
        endFrame: null,
        heardPhone: diag.heardPhone,
        l1Pattern: diag.l1Pattern,
        feedback: diag.feedback,
        alignLLPerFrame,
      });
      continue;
    }

    const mask = new Uint8Array(numPhones).fill(1);
    for (const cid of pids) {
      if (cid >= 0 && cid < numPhones) mask[cid] = 0;
    }

    let maxFrameScore = 0;
    let sumFrameScore = 0;
    for (const f of frames) {
      const nbRow = nbProbs[f];
      // Expected phoneme posterior (primary at full weight, natural allophones at 0.85 weight)
      let pExp = cidValue(nbRow, pids[0]);
      for (let k = 1; k < pids.length; k++) {
        const altP = cidValue(nbRow, pids[k]) * 0.85;
        if (altP > pExp) pExp = altP;
      }
      // Strongest competing non-target phoneme posterior
      let bestComp = 0;
      for (let j = 0; j < numPhones; j++) {
        if (mask[j] && nbRow[j] > bestComp) bestComp = nbRow[j];
      }
      const fScore = pExp / (pExp + bestComp + 1e-9);
      if (fScore > maxFrameScore) maxFrameScore = fScore;
      sumFrameScore += fScore;
    }

    const meanFrameScore = sumFrameScore / frames.length;
    // Raw acoustic posterior ratio (50% peak frame, 50% mean across aligned frames)
    // Never floored, invented, or artificially boosted.
    const score01 = Math.max(0, Math.min(1, 0.5 * maxFrameScore + 0.5 * meanFrameScore));
    const scorePct = Math.round(score01 * 100);
    const status = score01 >= 0.75 ? 'ok' : score01 >= 0.6 ? 'weak' : 'sub';

    const diag = diagnoseKoreanL1Phoneme({
      expectedPhone: phone,
      scorePct,
      frames,
      nbProbs,
      rawProbs,
      isWordFinal,
      nextWordStartFrame: nextStart,
      totalFrames: T,
    });

    out.push({
      phone,
      score: score01,
      scorePct,
      status,
      startFrame: frames[0],
      endFrame: frames[frames.length - 1],
      heardPhone: diag.heardPhone,
      l1Pattern: diag.l1Pattern,
      feedback: diag.feedback,
      alignLLPerFrame,
    });
  }

  return out;
}

function cidValue(row, id) {
  return id != null && id >= 0 && id < row.length ? row[id] : 0;
}

/**
 * Score an utterance from HuBERT phoneme logits using sound only:
 * 1. Acoustic likelihood gate (target forced-alignment LL vs free phoneme decode LL)
 * 2. Phoneme-level scores rolled up to word and line
 * 3. Red / Yellow / Green banding per app config
 * 4. Korean-L1 wrong-sound diagnostics per phoneme and word
 */
export function scoreUtteranceFromLogits(logitsOrFlat, timeSteps, targetText, opts = {}) {
  const appId = opts.appId || 'day4';
  const baseThresholds = getAppThresholds(appId);
  const passCut = typeof opts.passAt === 'number' ? opts.passAt : PASS_PCT;
  const thresholds = { green: baseThresholds.green, yellow: baseThresholds.yellow };

  const logits2D = unflattenLogits(logitsOrFlat, timeSteps, opts.vocab || VOCAB_SIZE);
  const T = logits2D.length;
  const { phones: expectedPhones, words: wordSpecs } = expectedPhoneSequence(targetText);

  if (!T || !expectedPhones.length) {
    return buildFailedAcousticResult(targetText, wordSpecs, thresholds, appId, 'too_short', {
      alignLLPerFrame: NEG_INF,
      freeLLPerFrame: 0,
      acousticMargin: NEG_INF,
    });
  }

  // Identify word-final phoneme indices for Korean-L1 final-consonant / epenthetic-vowel checks
  const wordFinalIndices = new Set();
  let runningIdx = 0;
  for (const ws of wordSpecs) {
    runningIdx += ws.phones.length;
    if (ws.phones.length > 0) wordFinalIndices.add(runningIdx - 1);
  }

  const { rawProbs, biasedLogProbs } = computeBiasedLogProbsAndPosteriors(
    logits2D,
    BLANK_ID,
    -3.2,
  );
  const freeDecode = freePhonemeDecode(biasedLogProbs, rawProbs, BLANK_ID);
  const phoneResults = forcedAlignGop(logits2D, expectedPhones, BLANK_ID, {
    blankBias: -3.2,
    wordFinalIndices,
    appId,
  });

  const alignLLPerFrame = phoneResults.length && Number.isFinite(phoneResults[0].alignLLPerFrame)
    ? phoneResults[0].alignLLPerFrame
    : NEG_INF;
  const acousticMargin = alignLLPerFrame - freeDecode.freeLLPerFrame;

  // Acoustic gate: check minimum frame count, non-blank speech activity, and acoustic likelihood ratio
  const minRequiredFrames = Math.max(4, Math.floor(expectedPhones.length * 0.7));
  const alignedPhoneCount = phoneResults.filter((p) => p.startFrame != null).length;
  const alignedPhoneRatio = expectedPhones.length ? alignedPhoneCount / expectedPhones.length : 0;

  // Margin threshold: target alignment must not be wildly worse than free phoneme decode
  const marginCut = typeof opts.acousticMarginCut === 'number' ? opts.acousticMarginCut : -0.85;
  const acousticFail =
    T < minRequiredFrames ||
    freeDecode.nonBlankFrameRatio < 0.03 ||
    alignedPhoneRatio < 0.5 ||
    acousticMargin < marginCut;

  // Roll up phoneme scores -> word scores -> line score (pure arithmetic mean, never boosted/floored)
  const words = [];
  let cursor = 0;
  for (const ws of wordSpecs) {
    const n = ws.phones.length;
    const pSlice = phoneResults.slice(cursor, cursor + n);
    cursor += n;

    let sumPct = 0;
    let firstFrame = null;
    let lastFrame = null;
    const l1Issues = [];

    const phonesFormatted = pSlice.map((p) => {
      sumPct += p.scorePct;
      if (p.startFrame != null && (firstFrame === null || p.startFrame < firstFrame)) {
        firstFrame = p.startFrame;
      }
      if (p.endFrame != null && (lastFrame === null || p.endFrame > lastFrame)) {
        lastFrame = p.endFrame;
      }
      const pBand = bandForScore(p.scorePct, appId, thresholds);
      if (p.feedback && pBand !== 'green') {
        l1Issues.push({
          phone: p.phone,
          heardPhone: p.heardPhone,
          pattern: p.l1Pattern,
          feedback: p.feedback,
        });
      }
      return {
        phone: p.phone,
        ipa: PHONE_IPA_LABEL[p.phone] || p.phone,
        score: p.score,
        scorePct: p.scorePct,
        band: pBand,
        color: pBand,
        status: p.status,
        heardPhone: p.heardPhone,
        l1Pattern: p.l1Pattern,
        feedback: p.feedback,
        startMs: p.startFrame == null ? 0 : p.startFrame * FRAME_MS,
        endMs: p.endFrame == null ? 0 : (p.endFrame + 1) * FRAME_MS,
      };
    });

    const rawWordScore = n > 0 ? sumPct / n : 0;
    const wordScorePct = Math.round(rawWordScore);
    const wordBand = acousticFail ? 'red' : bandForScore(wordScorePct, appId, thresholds);
    const primaryHint = l1Issues.length ? l1Issues[0].feedback : '';

    words.push({
      word: ws.display || ws.word,
      lookup: ws.word,
      g2pSource: ws.source,
      score: wordScorePct,
      scorePct: wordScorePct,
      rawScore: rawWordScore / 100,
      band: wordBand,
      color: wordBand,
      pass: !acousticFail && (wordBand === 'green' || wordBand === 'yellow'),
      startMs: firstFrame == null ? 0 : firstFrame * FRAME_MS,
      endMs: lastFrame == null ? 0 : (lastFrame + 1) * FRAME_MS,
      phones: phonesFormatted,
      hint: primaryHint,
      l1Issues,
    });
  }

  const lineRawAvg = words.length
    ? words.reduce((acc, w) => acc + w.score, 0) / words.length
    : 0;
  const lineScorePct = acousticFail ? 0 : Math.round(lineRawAvg);
  const redWords = words.filter((w) => w.band === 'red').map((w) => w.word);
  const yellowWords = words.filter((w) => w.band === 'yellow').map((w) => w.word);
  const greenWords = words.filter((w) => w.band === 'green').map((w) => w.word);

  // Determine overall line band (red / yellow / green)
  // If any word is red or lineScorePct < yellow, the line is red (student retries missed words).
  // If no word is red and lineScorePct >= yellow, student passes (green if >= green and no yellow words, else yellow).
  // Line colour by average score: green 75+, yellow 50-74, red under 50.
  // PASS = line average >= PASS_PCT (60).
  const lineBand = acousticFail ? 'red' : bandForScore(lineScorePct, appId, thresholds);
  const pass = !acousticFail && lineScorePct >= passCut;
  const needsModelAudioPlayback = acousticFail || redWords.length > 0 || yellowWords.length > 0 || lineBand !== 'green';

  return {
    score: lineScorePct / 100,
    scorePct: lineScorePct,
    rawScorePct: Math.round(lineRawAvg),
    band: lineBand,
    color: lineBand,
    pass,
    assistedPass: pass && lineBand !== 'green',
    needsAudioPlayback: needsModelAudioPlayback,
    weak: redWords,
    missedWords: redWords,
    yellowWords,
    greenWords,
    reason: acousticFail
      ? 'Say the sentence again, please. Say each word clearly.'
      : (pass ? '' : 'Listen to the voice, then try the missed words again.'),
    english: targetText,
    words,
    doorFail: acousticFail,
    acousticFail,
    acousticGate: {
      ok: !acousticFail,
      alignLLPerFrame,
      freeLLPerFrame: freeDecode.freeLLPerFrame,
      acousticMargin,
      nonBlankFrameRatio: freeDecode.nonBlankFrameRatio,
      decodedPhones: freeDecode.decodedPhones,
    },
    thresholds,
    appId,
    grader: 'hubert-phoneme',
    modelId: MODEL_ID,
  };
}

function buildFailedAcousticResult(targetText, wordSpecs, thresholds, appId, reasonCode, gateMetrics) {
  const words = (wordSpecs || []).map((ws) => ({
    word: ws.display || ws.word,
    lookup: ws.word,
    g2pSource: ws.source,
    score: 0,
    scorePct: 0,
    rawScore: 0,
    band: 'red',
    color: 'red',
    pass: false,
    startMs: 0,
    endMs: 0,
    phones: (ws.phones || []).map((p) => ({
      phone: p,
      ipa: PHONE_IPA_LABEL[p] || p,
      score: 0,
      scorePct: 0,
      band: 'red',
      color: 'red',
      status: 'del',
      heardPhone: null,
      l1Pattern: null,
      feedback: '',
      startMs: 0,
      endMs: 0,
    })),
    hint: '',
    l1Issues: [],
  }));
  return {
    score: 0,
    scorePct: 0,
    rawScorePct: 0,
    band: 'red',
    color: 'red',
    pass: false,
    assistedPass: false,
    needsAudioPlayback: true,
    weak: words.map((w) => w.word),
    missedWords: words.map((w) => w.word),
    yellowWords: [],
    greenWords: [],
    reason: 'Say the sentence again, please. Say each word clearly.',
    reasonCode,
    english: targetText,
    words,
    doorFail: true,
    acousticFail: true,
    acousticGate: {
      ok: false,
      ...gateMetrics,
    },
    thresholds,
    appId,
    grader: 'hubert-phoneme',
    modelId: MODEL_ID,
  };
}

/**
 * Legacy compatibility wrapper (`aggregate`) for any caller expecting the v1 schema.
 */
export function aggregate(text, wordPhones, phoneScores, audioDurationMs, sampleRate, modelId, latencyMs, opts = {}) {
  const appId = opts.appId || 'day4';
  const thresholds = getAppThresholds(appId);
  const wordsOut = [];
  let idx = 0;
  for (const wp of wordPhones) {
    const n = wp.phones.length;
    const chunk = phoneScores.slice(idx, idx + n);
    idx += n;
    let wscore = 0;
    let startMs = null;
    let endMs = null;
    if (chunk.length) {
      wscore = chunk.reduce((a, c) => a + c.score, 0) / chunk.length;
      startMs = chunk[0].startFrame == null ? null : chunk[0].startFrame * 20.0;
      endMs = chunk[chunk.length - 1].endFrame == null ? null : (chunk[chunk.length - 1].endFrame + 1) * 20.0;
    }
    const wPct = Math.round(wscore * 100);
    const wBand = bandForScore(wPct, appId, thresholds);
    wordsOut.push({
      word: wp.word,
      start_ms: startMs,
      end_ms: endMs,
      score: wscore,
      scorePct: wPct,
      band: wBand,
      color: wBand,
      phones: chunk.map((c) => ({
        phone: c.phone,
        score: c.score,
        scorePct: Math.round(c.score * 100),
        band: bandForScore(Math.round(c.score * 100), appId, thresholds),
        status: c.status,
        heardPhone: c.heardPhone || c.phone,
        l1Pattern: c.l1Pattern || null,
        feedback: c.feedback || '',
        start_ms: c.startFrame == null ? null : c.startFrame * 20.0,
        end_ms: c.endFrame == null ? null : (c.endFrame + 1) * 20.0,
      })),
    });
  }
  const overallScore = wordsOut.length
    ? wordsOut.reduce((a, w) => a + w.score, 0) / wordsOut.length
    : 0;
  const overallPct = Math.round(overallScore * 100);
  const band = bandForScore(overallPct, appId, thresholds);
  const weak = phoneScores.filter((p) => ['weak', 'sub', 'del', 'unknown'].includes(p.status)).length;
  const per = phoneScores.length ? weak / phoneScores.length : null;
  return {
    schema_version: '2.0',
    engine_id: 'mrj-pronounce',
    model_id: modelId || MODEL_ID,
    text,
    locale: 'en-US',
    expected_phones: wordPhones.flatMap((w) => w.phones),
    words: wordsOut,
    overall: { score: overallScore, scorePct: overallPct, band, color: band, phone_error_rate_est: per },
    audio: {
      duration_ms: audioDurationMs,
      sample_rate: sampleRate,
      clipping: opts.clipping ?? null,
      too_quiet: opts.too_quiet ?? null,
      snr_est: opts.snr_est ?? null,
    },
    meta: {
      scoring_mode: 'hubert_ctc_phoneme_v2',
      offline: true,
      latency_ms: latencyMs,
      warnings: opts.warnings || [],
      engine_version: '2.0.0-hubert',
    },
  };
}
