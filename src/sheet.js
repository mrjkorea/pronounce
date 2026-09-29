/** Pointing units: one "It is here", one "It is there", then the original lines. */

export const WHERE_LINE = /^where (is|are)\b/i;

export const HERE_THERE_LINES = [
  {
    slug: 'it-is-here',
    english: 'It is here',
    korean: '여기 있어요',
    image: 'images/it-is-here.webp',
    audio: 'audio/hear/it-is-here.mp3',
    local: true,
  },
  {
    slug: 'it-is-there',
    english: 'It is there',
    korean: '저기 있어요',
    image: 'images/it-is-there.webp',
    audio: 'audio/hear/it-is-there.mp3',
    local: true,
  },
];

export function isPointingUnit(unit) {
  const items = (unit && unit.items) || [];
  const whereCount = items.filter((it) => WHERE_LINE.test(String(it.english || '').trim())).length;
  const others = items.length - whereCount;
  return whereCount >= 7 && others <= 1;
}

export function sheetLines(bookId, unit) {
  const items = (unit && unit.items) || [];
  const originals = items.map((item) => ({
    kind: 'item',
    id: item.id,
    english: item.english,
    korean: item.korean,
    image: item.image || '',
    audio: item.audio || '',
    local: false,
    item,
  }));
  if (!isPointingUnit(unit)) return originals;
  const extras = HERE_THERE_LINES.map((row) => ({
    kind: 'extra',
    id: `${bookId}__${unit.id}__${row.slug}`,
    english: row.english,
    korean: row.korean,
    image: row.image,
    audio: row.audio,
    local: true,
    item: null,
  }));
  return extras.concat(originals);
}
