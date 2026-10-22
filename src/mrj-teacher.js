export function isMrjTeacher() {
  try {
    const api = globalThis.MRJSignin || globalThis.MRJ_AUTH;
    return !!(api && typeof api.isTeacher === "function" && api.isTeacher());
  } catch {
    return false;
  }
}
