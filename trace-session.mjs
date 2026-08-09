const PHASES = new Set(["idle", "armed", "drawing", "saving", "save-error", "reviewing"]);

function freezeState(state) {
  Object.freeze(state.points);
  return Object.freeze(state);
}

function clonePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return Object.freeze({ x, y });
}

function idleState(generation = 0, lastReason = null) {
  return freezeState({
    phase: "idle",
    generation,
    pageIndex: null,
    points: [],
    traceId: null,
    errorCode: null,
    lastReason,
  });
}

function result(state, effects = [], accepted = true) {
  return Object.freeze({
    state,
    effects: Object.freeze(effects.map((effect) => Object.freeze(effect))),
    accepted,
  });
}

function ignored(state) {
  return result(state, [], false);
}

function discard(state, reason) {
  return result(idleState(state.generation, reason), [
    { type: "DISCARD_GESTURE", reason },
    { type: "KEEP_PAUSED" },
  ]);
}

function draftEffect(state) {
  return {
    type: "CREATE_TRACE_DRAFT",
    generation: state.generation,
    pageIndex: state.pageIndex,
    points: state.points.map((point) => ({ ...point })),
  };
}

export function createTraceSessionState() {
  return idleState();
}

export function transitionTraceSession(state, event = {}) {
  if (!state || typeof state !== "object" || !PHASES.has(state.phase)) {
    throw new TypeError("trace session state 无效。");
  }
  const type = typeof event.type === "string" ? event.type : "";

  if (type === "RESET") {
    const reason = typeof event.reason === "string" && event.reason
      ? event.reason
      : "reset";
    return result(idleState(state.generation + 1, reason), [
      { type: "ABORT_TRACE_SESSION", reason },
    ]);
  }

  if (["SAVE_SUCCEEDED", "SAVE_FAILED"].includes(type)) {
    if (!Number.isInteger(event.generation) || event.generation !== state.generation) {
      return ignored(state);
    }
  }

  switch (type) {
    case "ARM": {
      if (state.phase !== "idle") return ignored(state);
      const next = freezeState({
        phase: "armed",
        generation: state.generation + 1,
        pageIndex: null,
        points: [],
        traceId: null,
        errorCode: null,
        lastReason: null,
      });
      return result(next, [
        { type: "PAUSE_READING" },
        { type: "CANCEL_TTS" },
        { type: "FREEZE_VIEWPORT" },
      ]);
    }
    case "POINTER_DOWN": {
      if (state.phase !== "armed") return ignored(state);
      const pageIndex = Number(event.pageIndex);
      const point = clonePoint(event.point);
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || !point) return ignored(state);
      return result(freezeState({
        ...state,
        phase: "drawing",
        pageIndex,
        points: [point],
      }));
    }
    case "POINTER_MOVE": {
      if (state.phase !== "drawing") return ignored(state);
      const pageIndex = Number(event.pageIndex);
      if (pageIndex !== state.pageIndex) return discard(state, "cross-page");
      const point = clonePoint(event.point);
      if (!point) return ignored(state);
      return result(freezeState({
        ...state,
        points: [...state.points, point],
      }));
    }
    case "POINTER_UP": {
      if (state.phase !== "drawing") return ignored(state);
      const pageIndex = Number(event.pageIndex);
      if (pageIndex !== state.pageIndex) return discard(state, "cross-page");
      const point = clonePoint(event.point);
      if (!point) return ignored(state);
      const points = [...state.points, point];
      if (event.valid !== true || points.length < 3) {
        const reason = typeof event.reason === "string" && event.reason
          ? event.reason
          : "invalid-gesture";
        return discard(state, reason);
      }
      const next = freezeState({
        ...state,
        phase: "saving",
        points,
        errorCode: null,
      });
      return result(next, [draftEffect(next)]);
    }
    case "CANCEL": {
      if (!["armed", "drawing"].includes(state.phase)) return ignored(state);
      const reason = typeof event.reason === "string" && event.reason
        ? event.reason
        : "cancelled";
      return discard(state, reason);
    }
    case "SAVE_SUCCEEDED": {
      if (state.phase !== "saving") return ignored(state);
      const traceId = typeof event.traceId === "string" ? event.traceId.trim() : "";
      if (!traceId) return ignored(state);
      const next = freezeState({
        ...state,
        phase: "reviewing",
        points: [],
        traceId,
        errorCode: null,
      });
      return result(next, [{ type: "SHOW_TRACE_REVIEW", traceId }]);
    }
    case "SAVE_FAILED": {
      if (state.phase !== "saving") return ignored(state);
      const errorCode = typeof event.errorCode === "string" && event.errorCode
        ? event.errorCode
        : "TRACE_SAVE_FAILED";
      const next = freezeState({
        ...state,
        phase: "save-error",
        errorCode,
      });
      return result(next, [{ type: "SHOW_TRACE_SAVE_ERROR", errorCode }]);
    }
    case "RETRY_SAVE": {
      if (state.phase !== "save-error") return ignored(state);
      const next = freezeState({
        ...state,
        phase: "saving",
        errorCode: null,
      });
      return result(next, [draftEffect(next)]);
    }
    case "DISCARD": {
      if (state.phase !== "save-error") return ignored(state);
      const reason = typeof event.reason === "string" && event.reason
        ? event.reason
        : "discarded";
      return discard(state, reason);
    }
    case "RETURN_TO_FLOW": {
      if (state.phase !== "reviewing") return ignored(state);
      const traceId = state.traceId;
      return result(idleState(state.generation, "returned-to-flow"), [
        { type: "BEGIN_REFLOW", traceId },
      ]);
    }
    default:
      return ignored(state);
  }
}
