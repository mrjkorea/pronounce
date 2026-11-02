/**
 * Server-backed teacher mode (MRJSignin 1.5.0+). Role is never inferred from localStorage alone.
 *
 * Apps listen for `mrj-teacher` (document) after a successful teacher unlock; body gets class `mrj-teacher`.
 * Panel UI lives in mrj-teacher-panel.js (Teacher chip → PIN → Start here panel).
 */
export {
  isMrjTeacher,
  installTeacherRefresh,
  promptTeacherUnlock,
  configureTeacherPanel,
  onTeacherChrome,
  mountTeacherPanel,
  togglePanel,
} from './mrj-teacher-panel.js';
