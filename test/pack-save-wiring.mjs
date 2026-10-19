import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'src/app.js'), 'utf8');
const schedulerSrc = readFileSync(join(root, 'src/pack-save-scheduler.js'), 'utf8');
const schedulerTestSrc = readFileSync(join(root, 'test/pack-save-scheduler.mjs'), 'utf8');

const BROWSER_AND_LANGUAGE_GLOBALS = [
  'window', 'document', 'localStorage', 'sessionStorage', 'location', 'navigator',
  'console', 'performance', 'history', 'fetch', 'crypto', 'queueMicrotask',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'Date', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'Number', 'String',
  'Boolean', 'Error', 'Map', 'Set', 'RegExp', 'URL', 'URLSearchParams',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'undefined', 'NaN', 'Infinity',
  'encodeURIComponent', 'decodeURIComponent', 'Uint8Array', 'Float32Array',
  'ArrayBuffer', 'DataView', 'Blob', 'File', 'Worker', 'CustomEvent', 'Event',
  'Intl', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone',
];

function skipSpaceAndComments(src, i) {
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f') {
      i += 1;
      continue;
    }
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i + 2);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function readString(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
          i = readString(src, i);
          continue;
        }
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function objectKeys(literal) {
  const keys = [];
  let i = skipSpaceAndComments(literal, 0);
  if (literal[i] !== '{') throw new Error('expected object literal');
  i += 1;
  let brace = 1;
  let paren = 0;
  let bracket = 0;
  let phase = 'key';
  const atBase = () => brace === 1 && paren === 0 && bracket === 0;

  while (i < literal.length && brace > 0) {
    i = skipSpaceAndComments(literal, i);
    if (i >= literal.length) break;
    const c = literal[i];

    if (c === "'" || c === '"' || c === '`') {
      if (phase === 'key' && atBase()) {
        const start = i;
        i = readString(literal, i);
        keys.push(literal.slice(start + 1, i - 1));
        i = skipSpaceAndComments(literal, i);
        if (literal[i] !== ':') throw new Error('expected colon after string key');
        i += 1;
        phase = 'value';
        continue;
      }
      i = readString(literal, i);
      continue;
    }

    if (phase === 'key' && atBase() && /[A-Za-z_$]/.test(c)) {
      const name = /^[A-Za-z_$][\w$]*/.exec(literal.slice(i))[0];
      const j = skipSpaceAndComments(literal, i + name.length);
      const next = literal[j];
      if (next === ':' || next === '=' || next === ',' || next === '}' || next === '(') {
        keys.push(name);
        if (next === ':' || next === '=') {
          i = j + 1;
          phase = 'value';
        } else {
          i = j;
          phase = 'after-shorthand';
        }
        continue;
      }
    }

    if (c === '{') brace += 1;
    else if (c === '}') {
      brace -= 1;
      if (brace === 0) break;
    } else if (c === '(') paren += 1;
    else if (c === ')') paren -= 1;
    else if (c === '[') bracket += 1;
    else if (c === ']') bracket -= 1;
    else if (c === ',' && atBase()) phase = 'key';
    i += 1;
  }
  return keys;
}

function extractCallObject(src, callee) {
  const marker = `${callee}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`missing ${callee}(`);
  let i = skipSpaceAndComments(src, start + marker.length);
  if (src[i] !== '{') throw new Error(`${callee}( is not passed an object`);
  const begin = i;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = readString(src, i);
      continue;
    }
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i + 2);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '{') brace += 1;
    else if (c === '}') {
      brace -= 1;
      if (brace === 0) return src.slice(begin, i + 1);
    } else if (c === '(') paren += 1;
    else if (c === ')') {
      if (paren === 0 && brace === 0) break;
      paren -= 1;
    } else if (c === '[') bracket += 1;
    else if (c === ']') bracket -= 1;
    i += 1;
  }
  throw new Error(`unterminated ${callee} object`);
}

function importLocalNames(src) {
  const names = [];
  const re = /\bimport\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]\s*;/g;
  let match;
  while ((match = re.exec(src))) {
    const clause = match[1].trim();
    const brace = clause.match(/\{([\s\S]*)\}/);
    if (brace) {
      for (const part of brace[1].split(',')) {
        const bit = part.trim();
        if (!bit) continue;
        const alias = bit.match(/^[\w$]+\s+as\s+([\w$]+)$/);
        if (alias) names.push(alias[1]);
        else if (/^[\w$]+$/.test(bit)) names.push(bit);
      }
    }
    const before = (brace ? clause.slice(0, clause.indexOf('{')) : clause).replace(/,/g, ' ').trim();
    const namespace = before.match(/^\*\s+as\s+([\w$]+)/);
    if (namespace) names.push(namespace[1]);
    else {
      const def = before.match(/^([\w$]+)/);
      if (def) names.push(def[1]);
    }
  }
  return names;
}

function topLevelBindings(src) {
  const names = [];
  const patterns = [
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(src))) names.push(match[1]);
  }
  return names;
}

function definedNames(src) {
  return [...new Set([
    ...BROWSER_AND_LANGUAGE_GLOBALS,
    ...importLocalNames(src),
    ...topLevelBindings(src),
  ])];
}

function stub() {
  const fn = function wiringStub() { return fn; };
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'then') return undefined;
      return fn;
    },
    set() { return true; },
    apply() { return fn; },
  });
}

function assertOptionsResolve(src, literal) {
  const names = definedNames(src);
  const factory = new Function(
    ...names,
    `"use strict"; return (${literal});`,
  );
  const value = stub();
  let options;
  try {
    options = factory(...names.map(() => value));
  } catch (err) {
    assert.fail(`createPackSaveScheduler(...) threw ${err.name}: ${err.message}`);
  }
  const referenceErrors = [];
  for (const [key, option] of Object.entries(options)) {
    if (typeof option !== 'function') continue;
    try {
      option(value, value);
    } catch (err) {
      if (err instanceof ReferenceError) referenceErrors.push(`${key}: ${err.message}`);
    }
  }
  assert.deepEqual(referenceErrors, []);
  return options;
}

function schedulerParamNames() {
  const literal = extractCallObject(
    schedulerSrc.replace('export function createPackSaveScheduler(', 'createPackSaveScheduler('),
    'createPackSaveScheduler',
  );
  return objectKeys(literal);
}

test('app.js pack-save options are defined names the scheduler accepts', () => {
  const literal = extractCallObject(appSrc, 'createPackSaveScheduler');
  const keys = objectKeys(literal);
  const params = new Set(schedulerParamNames());
  const unknown = keys.filter((key) => !params.has(key));
  assert.deepEqual(unknown, [], `unknown createPackSaveScheduler options: ${unknown.join(', ')}`);
  assertOptionsResolve(appSrc, literal);
  assert.match(literal, /shouldFlushOnPagehide:\s*shouldFlushPackOnPagehide\b/);
  assert.doesNotMatch(literal, /(?:^|[,{]\s*)shouldFlushOnPagehide\s*[,}]/);
});

test('pack-save scheduler tests pass only scheduler parameter names', () => {
  const literal = extractCallObject(schedulerTestSrc, 'createPackSaveScheduler');
  const keys = objectKeys(literal);
  const params = new Set(schedulerParamNames());
  const unknown = keys.filter((key) => !params.has(key));
  assert.deepEqual(unknown, [], `unknown createPackSaveScheduler options: ${unknown.join(', ')}`);
  assert.ok(keys.includes('shouldFlushOnPagehide'));
});
