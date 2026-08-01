// tts-point-session.mjs — pure last-click-wins point-reading state

function finiteSpeed(value) {
  const speed = Number(value);
  return Number.isFinite(speed) ? speed : null;
}

export function createPointReadSession() {
  let generation = 0;
  let current = null;
  let baseline = null;
  let interrupted = false;
  let holdActive = false;
  let lastReason = null;
  let lastOutcome = null;

  const isCurrent = (token) => (
    Boolean(current) &&
    Number.isInteger(token?.id) &&
    token.id === current.token.id
  );

  const snapshot = () => ({
    active: Boolean(current),
    token: current?.token ?? null,
    targetKey: current?.targetKey ?? null,
    phase: current?.phase ?? "idle",
    baseline: baseline ? { ...baseline } : null,
    interrupted,
    holdActive,
    lastReason,
    lastOutcome,
  });

  const begin = ({
    targetKey = null,
    wasPlaying = false,
    speed = null,
  } = {}) => {
    const shouldPreserveBaseline = Boolean(current && baseline && !interrupted);
    if (!shouldPreserveBaseline) {
      baseline = {
        wasPlaying: Boolean(wasPlaying),
        speed: finiteSpeed(speed),
      };
      interrupted = false;
    }

    generation += 1;
    const token = Object.freeze({
      id: generation,
      targetKey: targetKey === null || targetKey === undefined ? null : String(targetKey),
    });
    current = {
      token,
      targetKey: token.targetKey,
      phase: "requested",
    };
    holdActive = Boolean(baseline?.wasPlaying) && !interrupted;
    lastOutcome = null;
    return {
      token,
      shouldPause: Boolean(wasPlaying),
      baseline: { ...baseline },
    };
  };

  const markPhase = (token, phase) => {
    if (!isCurrent(token)) return false;
    current.phase = typeof phase === "string" && phase ? phase : current.phase;
    return true;
  };

  const interrupt = (reason = "user-intervention") => {
    if (!current) {
      lastReason = reason;
      return snapshot();
    }
    interrupted = true;
    holdActive = false;
    lastReason = reason;
    return snapshot();
  };

  const settle = (token, { outcome = "ended" } = {}) => {
    const resolvedOutcome = typeof outcome === "string" && outcome ? outcome : "ended";
    if (!isCurrent(token)) {
      return {
        accepted: false,
        shouldResume: false,
        resumeSpeed: null,
        outcome: resolvedOutcome,
      };
    }

    const shouldResume = (
      resolvedOutcome === "ended" &&
      Boolean(baseline?.wasPlaying) &&
      !interrupted
    );
    const resumeSpeed = shouldResume ? baseline?.speed ?? null : null;
    current = null;
    baseline = null;
    holdActive = false;
    lastOutcome = resolvedOutcome;
    return {
      accepted: true,
      shouldResume,
      resumeSpeed,
      outcome: resolvedOutcome,
    };
  };

  const cancel = (reason = "cancelled") => {
    generation += 1;
    current = null;
    baseline = null;
    interrupted = false;
    holdActive = false;
    lastReason = reason;
    lastOutcome = "cancelled";
    return snapshot();
  };

  return {
    begin,
    markPhase,
    isCurrent,
    interrupt,
    settle,
    cancel,
    snapshot,
  };
}
