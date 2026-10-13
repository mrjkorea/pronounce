import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const contentDir = join(root, 'content');

const QUESTION_CODES = {
  HITW: 'How is the weather?',
  WCYD: 'What can you draw?',
  WDYW: 'What do you want?',
  WIMP: 'Where is my phone?',
  WDIIT: 'What day is it today?',
  'WTII(N)': 'What time is it?',
  WTII: 'What time is it?',
  WFDYL: 'What flavor do you like?',
  WITB: 'What is this bug?',
  HWIYN: 'How will I yell your name?',
  WGAYI: 'What grade are you in?',
  WFAT: 'What fruit are these?',
  WDYH: 'What do you have?',
};

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function koreanCode(korean) {
  const m = String(korean || '').match(/^([A-Z0-9()]+)\?\s*/);
  return m ? m[1] : null;
}

function analyzeUnit(unit) {
  const items = unit.items;
  const codes = items.map((it) => koreanCode(it.korean));
  const coded = codes.filter(Boolean);
  const allSameCode = coded.length === items.length && coded.every((c) => c === coded[0]);
  const code = allSameCode ? coded[0] : null;
  if (code === 'ITA') return { mode: 'ita-rows' };
  if (code === 'CIPO') return { mode: 'cipo-rows' };
  if (code && code !== 'ITA' && QUESTION_CODES[code]) {
    return { mode: 'shared', question: QUESTION_CODES[code] };
  }
  const titleQ = unit.title.trim().endsWith('?');
  const allAnswers = items.every((it) => !it.english.trim().endsWith('?'));
  if (titleQ && allAnswers) return { mode: 'shared', question: unit.title.trim() };
  return { mode: 'plain' };
}

function hearAnswerRel(text) {
  return `audio/hear/${slug(text)}.mp3`;
}

function questionAudioRel(text) {
  return `audio/hear/questions/${slug(text)}.mp3`;
}

function itaQuestion(item) {
  const alt = (item.alts || []).find((a) => String(a).trim().endsWith('?'));
  if (alt) return String(alt).trim();
  const en = item.english.trim();
  const m = en.match(/^It is (an?|a) (.+)$/i);
  if (m) return `Is this ${m[1]} ${m[2]}?`;
  return en;
}

/** All relative paths loaded via hearSrc / row pictures (formerly HEAR_BASE). */
export async function collectHearAssetPaths() {
  const paths = new Set();
  const files = (await import('node:fs/promises')).readdir(contentDir);
  const names = (await files).filter((n) => n.endsWith('.json') && n !== 'manifest.json' && n !== 'l1.json');

  for (const name of names) {
    const data = JSON.parse(await readFile(join(contentDir, name), 'utf8'));
    for (const unit of data.units) {
      const plan = analyzeUnit(unit);
      if (plan.mode === 'shared' && plan.question) {
        paths.add(questionAudioRel(plan.question));
      }
      for (const item of unit.items) {
        if (item.image) paths.add(item.image);
        if (item.audio) paths.add(item.audio);
        if (plan.mode === 'cipo-rows') {
          const ans = (item.alts || []).find((a) => String(a).trim());
          if (ans) paths.add(hearAnswerRel(String(ans).trim()));
        }
        if (plan.mode === 'ita-rows') {
          paths.add(questionAudioRel(itaQuestion(item)));
        }
      }
    }
  }

  paths.add('images/it-is-here.webp');
  paths.add('images/it-is-there.webp');
  paths.add('audio/hear/it-is-here.mp3');
  paths.add('audio/hear/it-is-there.mp3');

  return paths;
}
