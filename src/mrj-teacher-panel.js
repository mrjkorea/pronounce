/**
 * Day 4 teacher unlock panel — PIN via mrj-auth Teacher chip; this module is the
 * control panel + top-bar entry (no duplicate PIN UI).
 */

let panelOpen = false;
let panelEl = null;
let backdropEl = null;
let toolsBtnEl = null;
let appHooks = null;

function auth() {
  return globalThis.MRJ_AUTH || globalThis.MRJSignin || null;
}

export function isMrjTeacher() {
  try {
    if (globalThis.document?.body?.classList?.contains('mrj-teacher')) return true;
    const api = auth();
    return !!(api && typeof api.isTeacher === 'function' && api.isTeacher());
  } catch {
    return false;
  }
}

export function promptTeacherUnlock() {
  const api = auth();
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
  const run = () => {
    try {
      onRefresh();
    } catch {
      /* ignore */
    }
  };
  globalThis.document.addEventListener('mrj-teacher', run);
  globalThis.document.addEventListener('mrj-teacher-unlock-changed', run);
}

function el(tag, cls, text) {
  const node = globalThis.document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function grantLabel(grant, hooks) {
  if (!grant) return '';
  if (grant.mode === 'open') return 'Entire path open';
  if (grant.mode === 'start' && grant.bookId && grant.unitId) {
    const bookLabel = hooks?.bookLabel ? hooks.bookLabel(grant.bookId) : grant.bookId;
    const unitLabel = hooks?.unitLabel
      ? hooks.unitLabel(grant.bookId, grant.unitId)
      : grant.unitId;
    return `Start at ${bookLabel} · ${unitLabel}`;
  }
  return 'Teacher unlock';
}

function closePanel() {
  panelOpen = false;
  backdropEl?.parentNode?.removeChild(backdropEl);
  panelEl?.parentNode?.removeChild(panelEl);
  backdropEl = null;
  panelEl = null;
  globalThis.document?.body?.classList.remove('p4-teacher-panel-open');
}

function renderPanelBody() {
  if (!panelEl || !appHooks) return;
  const body = panelEl.querySelector('.p4-teacher-panel-body');
  if (!body) return;
  body.innerHTML = '';
  const studentLabel = appHooks.studentLabel ? appHooks.studentLabel() : '';
  if (!studentLabel) {
    body.appendChild(el('p', 'p4-teacher-panel-note', 'Sign in as a student first, then use Teacher PIN.'));
    return;
  }
  body.appendChild(el('p', 'p4-teacher-panel-lead', `Student: ${studentLabel}`));

  const grants = appHooks.listGrants ? appHooks.listGrants() : [];
  if (grants.length) {
    body.appendChild(el('h2', 'p4-teacher-panel-h', 'Teacher unlocks'));
    const ul = el('ul', 'p4-teacher-grant-list');
    grants.forEach((row) => {
      const li = el('li', 'p4-teacher-grant-item');
      li.appendChild(el('span', 'p4-teacher-grant-text', grantLabel(row.grant, appHooks)));
      const undo = el('button', 'p4-teacher-btn p4-teacher-btn-undo', 'Undo');
      undo.type = 'button';
      undo.addEventListener('click', () => {
        appHooks.undoGrant?.();
        renderPanelBody();
      });
      li.appendChild(undo);
      ul.appendChild(li);
    });
    body.appendChild(ul);
  } else {
    body.appendChild(el('p', 'p4-teacher-panel-note', 'No teacher unlocks saved for this student yet.'));
  }

  const openAll = el('button', 'p4-teacher-btn p4-teacher-btn-wide', 'Open entire path');
  openAll.type = 'button';
  openAll.addEventListener('click', () => {
    appHooks.openAllPath?.();
    renderPanelBody();
  });
  body.appendChild(openAll);

  const ctx = appHooks.routeContext ? appHooks.routeContext() : {};
  if (ctx.bookId && appHooks.listUnits) {
    body.appendChild(el('h2', 'p4-teacher-panel-h', ctx.bookLabel || ctx.bookId));
    const list = el('div', 'p4-teacher-unit-list');
    (appHooks.listUnits(ctx.bookId) || []).forEach((u) => {
      const row = el('div', 'p4-teacher-unit-row');
      row.appendChild(el('span', 'p4-teacher-unit-title', u.title));
      const start = el('button', 'p4-teacher-btn', 'Start from here');
      start.type = 'button';
      start.addEventListener('click', () => {
        appHooks.startFrom?.(ctx.bookId, u.id);
        renderPanelBody();
      });
      row.appendChild(start);
      list.appendChild(row);
    });
    body.appendChild(list);
  } else {
    body.appendChild(el(
      'p',
      'p4-teacher-panel-note',
      'Open a book to pick a unit, or use Start from here on each unit row.',
    ));
  }
}

function openPanel() {
  if (!globalThis.document || !isMrjTeacher()) return;
  if (panelOpen) {
    renderPanelBody();
    return;
  }
  if (!appHooks) return;
  panelOpen = true;
  globalThis.document.body.classList.add('p4-teacher-panel-open');
  backdropEl = el('div', 'p4-teacher-panel-backdrop');
  backdropEl.addEventListener('click', closePanel);
  panelEl = el('div', 'p4-teacher-panel');
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-label', 'Teacher unlock');
  const head = el('div', 'p4-teacher-panel-head');
  head.appendChild(el('h1', null, 'Teacher · start from here'));
  const closeBtn = el('button', 'p4-teacher-panel-close', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', closePanel);
  head.appendChild(closeBtn);
  panelEl.appendChild(head);
  panelEl.appendChild(el('div', 'p4-teacher-panel-body'));
  globalThis.document.body.appendChild(backdropEl);
  globalThis.document.body.appendChild(panelEl);
  renderPanelBody();
}

export function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

function ensureToolsButton() {
  if (!globalThis.document || toolsBtnEl) return;
  const teacherBtn = globalThis.document.querySelector('.mrj-auth-teacher-btn');
  if (!teacherBtn?.parentNode) return;
  toolsBtnEl = el('button', 'p4-teacher-tools-btn', 'Start here');
  toolsBtnEl.type = 'button';
  toolsBtnEl.title = 'Teacher start / unlock panel';
  toolsBtnEl.hidden = true;
  toolsBtnEl.addEventListener('click', (ev) => {
    ev.stopPropagation();
    togglePanel();
  });
  teacherBtn.parentNode.insertBefore(toolsBtnEl, teacherBtn.nextSibling);
}

function syncToolsButton() {
  ensureToolsButton();
  if (!toolsBtnEl) return;
  toolsBtnEl.hidden = !isMrjTeacher();
  if (!isMrjTeacher()) closePanel();
}

export function onTeacherChrome() {
  syncToolsButton();
  if (isMrjTeacher()) openPanel();
  else closePanel();
}

export function configureTeacherPanel(hooks) {
  appHooks = hooks || null;
  if (panelOpen) renderPanelBody();
}

export function mountTeacherPanel() {
  syncToolsButton();
}

if (typeof globalThis !== 'undefined') {
  globalThis.MRJTeacherUnlock = {
    isMrjTeacher,
    installRefresh: installTeacherRefresh,
    promptTeacherUnlock,
    configure: configureTeacherPanel,
    openPanel,
    closePanel,
    togglePanel,
    onTeacherChrome,
    mount: mountTeacherPanel,
  };
}
