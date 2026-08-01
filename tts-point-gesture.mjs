// Pure pointer/selection gate for point-to-read interactions.

export function shouldActivatePointReadGesture({
  button = -1,
  pointerType = "mouse",
  movement = Number.POSITIVE_INFINITY,
  maxMovement = 6,
  downTargetKey = null,
  upTargetKey = null,
  selectionCollapsed = true,
  modified = false,
} = {}) {
  return Boolean(
    button === 0 &&
    pointerType !== "touch" &&
    Number.isFinite(Number(movement)) &&
    Number(movement) <= Math.max(0, Number(maxMovement) || 0) &&
    downTargetKey &&
    downTargetKey === upTargetKey &&
    selectionCollapsed &&
    !modified
  );
}

export function shouldRenderPointReadHover({
  sessionActive = false,
  buttons = 0,
  policyEnabled = false,
  masterEnabled = false,
  ready = false,
} = {}) {
  return Boolean(
    !sessionActive &&
    buttons === 0 &&
    policyEnabled &&
    masterEnabled &&
    ready
  );
}
