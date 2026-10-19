/**
 * Throttled pronounce pack saves to MRJ_AUTH.savePack. Node-testable (no DOM).
 */

export function createPackSaveScheduler({
  minIntervalMs,
  getPackLoadOk,
  setPackLoadOk,
  isAuthReady,
  readLocalScores,
  getLoadedServerScores,
  setLoadedServerScores,
  savePack,
  ensurePackLoaded,
  buildPackSavePayload,
  scoresNeedSaveAfterSync,
  shouldFlushOnPagehide,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimerFn = (id) => clearTimeout(id),
}) {
  const state = {
    dirty: false,
    saveTimer: null,
    flushPending: false,
    lastSaveAt: 0,
    inFlight: false,
    saveAfterInFlight: false,
    packLoadPending: false,
  };

  function clearSaveTimer() {
    if (state.saveTimer != null) {
      clearTimerFn(state.saveTimer);
      state.saveTimer = null;
    }
  }

  function markDirty() {
    state.dirty = true;
    schedule();
  }

  async function tryEnsurePackLoaded() {
    if (!ensurePackLoaded || state.packLoadPending) return;
    state.packLoadPending = true;
    try {
      const ok = await ensurePackLoaded();
      if (ok && state.dirty) schedule(0);
    } finally {
      state.packLoadPending = false;
    }
  }

  function schedule(delayMs) {
    if (!getPackLoadOk()) {
      if (state.dirty) void tryEnsurePackLoaded();
      return;
    }
    if (!isAuthReady()) return;
    if (state.inFlight) {
      state.saveAfterInFlight = true;
      return;
    }
    clearSaveTimer();
    const t = now();
    const wait = delayMs != null
      ? delayMs
      : Math.max(0, minIntervalMs - (t - state.lastSaveAt));
    state.saveTimer = setTimer(() => {
      state.saveTimer = null;
      void flush(false);
    }, wait);
  }

  async function flush(force, opts) {
    if (!getPackLoadOk()) {
      if (state.dirty) void tryEnsurePackLoaded();
      return;
    }
    if (opts && opts.pagehide && !shouldFlushOnPagehide(state.dirty, getPackLoadOk())) return;
    if (!isAuthReady()) return;
    const t = now();
    if (!force && t - state.lastSaveAt < minIntervalMs) {
      schedule();
      return;
    }
    if (!state.dirty && !(opts && opts.pagehide)) return;
    if (state.inFlight) {
      state.flushPending = true;
      return;
    }
    state.inFlight = true;
    let savedPayload = null;
    try {
      savedPayload = buildPackSavePayload(readLocalScores(), getLoadedServerScores());
      const res = await savePack(JSON.stringify(savedPayload));
      if (res && res.ok) {
        state.lastSaveAt = now();
        setLoadedServerScores(savedPayload);
        const current = buildPackSavePayload(readLocalScores(), getLoadedServerScores());
        state.dirty = scoresNeedSaveAfterSync(current, savedPayload);
        if (state.dirty) void flush(true);
      } else {
        state.dirty = true;
        if (!isAuthReady() || (res && res.error === 'pack_not_loaded')) {
          setPackLoadOk(false);
          void tryEnsurePackLoaded();
        } else {
          schedule(minIntervalMs);
        }
      }
    } catch (_) {
      state.dirty = true;
      schedule(minIntervalMs);
    } finally {
      state.inFlight = false;
      if (state.flushPending) {
        state.flushPending = false;
        void flush(true);
      } else if (state.saveAfterInFlight) {
        state.saveAfterInFlight = false;
        if (state.dirty) void flush(true);
      }
    }
  }

  function prepareForServerSync() {
    clearSaveTimer();
    state.saveAfterInFlight = false;
    state.flushPending = false;
  }

  return {
    state,
    markDirty,
    schedule,
    flush,
    clearSaveTimer,
    prepareForServerSync,
    setDirty: (v) => { state.dirty = !!v; },
    getDirty: () => state.dirty,
    setLastSaveAt: (v) => { state.lastSaveAt = v; },
  };
}
