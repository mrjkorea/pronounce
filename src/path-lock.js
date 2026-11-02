/** Unit/day path gates for Pronounce navigation and sheet line order. */
import { sheetLines } from './sheet.js';

/** Jay: temporary unlock all unit/path gates until teacher unlock UI is enough for class. */
export const TEMP_UNLOCK_ALL = true;

/**
 * Section open when TEMP_UNLOCK_ALL, teacher session, natural progress, or teacherPathGrant (see teacher-grants.js).
 * Turn off TEMP_UNLOCK_ALL here when classroom is ready for sequential locks again.
 */
export function pathLocksActive(ctx = {}) {
  const unlockAll = ctx.unlockAll != null ? ctx.unlockAll : TEMP_UNLOCK_ALL;
  if (unlockAll) return false;
  if (ctx.teacher) return false;
  return true;
}

export function teacherOpenStepIndex(steps, grant) {
  if (!grant || !steps || !steps.length) return -1;
  if (grant.mode === 'open') return steps.length;
  if (grant.mode === 'start' && grant.bookId && grant.unitId) {
    return pathStepIndex(steps, grant.bookId, grant.unitId);
  }
  return -1;
}

export function effectiveOpenPathIndex(steps, books, scores, linePassed, grant) {
  const natural = firstOpenPathIndex(steps, books, scores, linePassed);
  const teacherIdx = teacherOpenStepIndex(steps, grant);
  if (teacherIdx < 0) return natural;
  return Math.max(natural, teacherIdx);
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
  const openIdx = effectiveOpenPathIndex(
    steps,
    ctx.books,
    ctx.scores,
    ctx.linePassed,
    ctx.teacherPathGrant,
  );
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
