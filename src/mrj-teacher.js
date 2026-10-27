/**
 * Server-backed teacher mode (MRJSignin 1.5.0+). Role is never inferred from localStorage alone.
 *
 * Apps listen for `mrj-teacher` (document) after a successful teacher unlock; body gets class `mrj-teacher`.
 * Prefer `MRJTeacherUnlock.isMrjTeacher()` or import `isMrjTeacher` from this module.
 */
export function isMrjTeacher() {
  try {
    if (globalThis.document?.body?.classList?.contains('mrj-teacher')) return true;
    const api = globalThis.MRJSignin || globalThis.MRJ_AUTH;
    return !!(api && typeof api.isTeacher === 'function' && api.isTeacher());
  } catch {
    return false;
  }
}

export function promptTeacherUnlock() {
  const api = globalThis.MRJSignin || globalThis.MRJ_AUTH;
  if (!api) return;
  if (typeof api.openTeacherUnlock === 'function') {
    api.openTeacherUnlock();
    return;
  }
  if (typeof api.promptTeacherUnlock === 'function') {
    api.promptTeacherUnlock();
  }
}

export function installTeacherRefresh(onRefresh) {
  if (!globalThis.document || typeof onRefresh !== 'function') return;
  globalThis.document.addEventListener('mrj-teacher', () => {
    try {
      onRefresh();
    } catch {
      /* ignore */
    }
  });
}

const unlockApi = {
  isMrjTeacher,
  installRefresh: installTeacherRefresh,
  promptTeacherUnlock,
};

if (typeof globalThis !== 'undefined') {
  globalThis.MRJTeacherUnlock = unlockApi;
}
