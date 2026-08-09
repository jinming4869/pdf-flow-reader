import { SPEED_TIERS, speedTier } from "./reading-model.mjs";

const MINIMUM_SPEED = 4;
const MAXIMUM_SPEED = SPEED_TIERS.at(-1).max;

function boundedSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) throw new TypeError("回流速度必须是有限数值。");
  return Math.max(MINIMUM_SPEED, Math.min(MAXIMUM_SPEED, speed));
}

export function smoothstep(value) {
  const t = Math.max(0, Math.min(1, Number(value) || 0));
  return t * t * (3 - 2 * t);
}

export function reflowTargetForSpeed(value, { upperRatio = 0.82 } = {}) {
  const current = boundedSpeed(value);
  const tier = speedTier(current);
  const index = SPEED_TIERS.findIndex((entry) => entry.themeKey === tier.themeKey);
  const minimum = index <= 0 ? MINIMUM_SPEED : SPEED_TIERS[index - 1].max + 1;
  const ratio = Math.max(0.5, Math.min(0.95, Number(upperRatio) || 0.82));
  const upperTarget = Math.round(minimum + (tier.max - minimum) * ratio);
  return Math.min(tier.max, Math.max(current, upperTarget));
}

export function createReflowController({
  shortDurationMs = 30_000,
  longDurationMs = 90_000,
  longPauseThresholdMs = 10 * 60_000,
  upperRatio = 0.82,
} = {}) {
  let generation = 0;
  let state = {
    active: false,
    mode: null,
    durationMs: 0,
    startedAt: null,
    startSpeed: null,
    targetSpeed: null,
    lastSpeed: null,
    lastReason: null,
  };

  const snapshot = () => Object.freeze({ ...state, generation });

  const sampleAt = (timestamp) => {
    const elapsed = Math.max(0, Number(timestamp) - state.startedAt);
    const progress = Math.max(0, Math.min(1, elapsed / state.durationMs));
    const eased = smoothstep(progress);
    const speed = state.startSpeed + (state.targetSpeed - state.startSpeed) * eased;
    return {
      progress,
      speed,
      done: progress >= 1,
    };
  };

  const start = ({
    currentSpeed,
    interruptionMs = 0,
    reason = "resume",
    now = performance.now(),
  } = {}) => {
    const startSpeed = boundedSpeed(currentSpeed);
    const targetSpeed = reflowTargetForSpeed(startSpeed, { upperRatio });
    const longReason = ["new-document", "app-resume"].includes(reason);
    const mode = longReason || Number(interruptionMs) >= longPauseThresholdMs
      ? "long"
      : "short";
    const durationMs = mode === "long" ? longDurationMs : shortDurationMs;
    generation += 1;
    state = {
      active: targetSpeed > startSpeed,
      mode,
      durationMs,
      startedAt: Number(now),
      startSpeed,
      targetSpeed,
      lastSpeed: startSpeed,
      lastReason: reason,
    };
    return snapshot();
  };

  const sample = (timestamp = performance.now()) => {
    if (!state.active) return null;
    const value = sampleAt(timestamp);
    state.lastSpeed = value.speed;
    if (value.done) state.active = false;
    return Object.freeze({
      active: state.active,
      done: value.done,
      mode: state.mode,
      progress: value.progress,
      speed: value.speed,
      targetSpeed: state.targetSpeed,
    });
  };

  const cancel = (reason = "user-intervention", { now = performance.now() } = {}) => {
    if (state.active) {
      const value = sampleAt(now);
      state.lastSpeed = value.speed;
    }
    generation += 1;
    state.active = false;
    state.lastReason = reason;
    return snapshot();
  };

  return Object.freeze({
    start,
    sample,
    cancel,
    snapshot,
  });
}
