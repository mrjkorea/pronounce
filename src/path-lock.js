/** Unit/day path gates for Pronounce navigation and sheet line order. */
import { sheetLines } from './sheet.js';

/** Jay: temporary unlock all unit/path gates until proper teacher unlock UI ships. */
export const TEMP_UNLOCK_ALL = true;

export function pathLocksActive(ctx = {}) {
  const unlockAll = ctx.unlockAll != null ? ctx.unlockAll : TEMP_UNLOCK_ALL;
  if (unlockAll) return false;
  if (ctx.teacher) return false;
  return true;
}

export function buildPathSteps(books, bookOrder) {
  const steps = [];
  const byId = new Map((books || []).map((b) => [b.id, b]));
  for (const bookId of bookOrder || []) {
    const book = byId.get(bookId);
    if (!book || !Array.isArray(book.units)) continue;
    for (const unit of book.units) {
      steps.push({ bookId: book.id, unitId: unit.id });
    }
  }
  return steps;
}

export function unitFullyPassed(book, unit, scores, linePassed) {
  const lines = sheetLines(book.id, unit);
  if (!lines.length) return false;
  return lines.every((line) => linePassed(line, unit, scores));
}

export function firstOpenPathIndex(steps, books, scores, linePassed) {
  const byId = new Map((books || []).map((b) => [b.id, b]));
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const book = byId.get(step.bookId);
    const unit = book && book.units.find((u) => u.id === step.unitId);
    if (!book || !unit) continue;
    if (!unitFullyPassed(book, unit, scores, linePassed)) return i;
  }
  return steps.length;
}

export function pathStepIndex(steps, bookId, unitId) {
  return (steps || []).findIndex((s) => s.bookId === bookId && s.unitId === unitId);
}

export function isUnitPathOpen(bookId, unitId, ctx) {
  if (!pathLocksActive(ctx)) return true;
  const steps = ctx.steps || [];
  const idx = pathStepIndex(steps, bookId, unitId);
  if (idx < 0) return true;
  const openIdx = firstOpenPathIndex(steps, ctx.books, ctx.scores, ctx.linePassed);
  return idx <= openIdx;
}

export function isBookPathOpen(bookId, ctx) {
  if (!pathLocksActive(ctx)) return true;
  const book = (ctx.books || []).find((b) => b.id === bookId);
  if (!book || !book.units.length) return true;
  return isUnitPathOpen(bookId, book.units[0].id, ctx);
}

export function isLinePathOpen(bookId, unit, lineId, ctx) {
  if (!pathLocksActive(ctx)) return true;
  if (!isUnitPathOpen(bookId, unit.id, ctx)) return false;
  const lines = sheetLines(bookId, unit);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!ctx.linePassed(line, unit, ctx.scores)) return line.id === lineId;
  }
  return true;
}
