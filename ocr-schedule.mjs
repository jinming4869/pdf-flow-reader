export function ocrTaskKey({
  centerPage = 0,
  priorityPage = 0,
  generation = 0,
} = {}) {
  return `${Number(generation) || 0}:${Number(centerPage) || 0}:${Number(priorityPage) || 0}`;
}

export function continuousOcrAheadPage({
  enabled = false,
  tierKey = null,
  isPlaying = false,
  workloadActive = false,
  currentPage = 0,
  pageCount = 0,
  nextPageNativeKnown = false,
  nextPageTtsReady = false,
  nextPageOcrKnown = false,
  nextPageFailed = false,
} = {}) {
  const page = Math.round(Number(currentPage) || 0);
  const total = Math.max(0, Math.round(Number(pageCount) || 0));
  if (
    !enabled ||
    tierKey !== "snow-mist" ||
    !isPlaying ||
    workloadActive ||
    page < 1 ||
    page >= total ||
    !nextPageNativeKnown ||
    nextPageTtsReady ||
    nextPageOcrKnown ||
    nextPageFailed
  ) {
    return null;
  }
  return page + 1;
}

export function createOcrTaskScheduler({
  delayMs = 180,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  onReady,
  onError,
} = {}) {
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new TypeError("OCR 调度器需要定时器实现。");
  }
  if (typeof onReady !== "function") {
    throw new TypeError("OCR 调度器需要 onReady 回调。");
  }

  let timerId = null;
  let pendingTask = null;
  let activeTask = null;

  function schedule(task = {}) {
    const key = ocrTaskKey(task);
    if (pendingTask?.key === key) {
      return { scheduled: false, reused: true, key };
    }

    if (pendingTask && timerId !== null) {
      pendingTask = { ...task, key };
      return {
        scheduled: true,
        reused: false,
        replaced: true,
        key,
      };
    }

    if (activeTask?.key === key) {
      return { scheduled: false, reused: true, key };
    }

    pendingTask = { ...task, key };
    timerId = setTimeoutFn(() => {
      timerId = null;
      const nextTask = pendingTask;
      pendingTask = null;
      if (!nextTask) return;
      activeTask = nextTask;
      Promise.resolve()
        .then(() => onReady(nextTask))
        .catch((error) => onError?.(error, nextTask))
        .finally(() => {
          if (activeTask === nextTask) activeTask = null;
        });
    }, delayMs);

    return {
      scheduled: true,
      reused: false,
      replaced: false,
      key,
    };
  }

  function cancel(reason = "cancelled") {
    if (timerId !== null) clearTimeoutFn(timerId);
    timerId = null;
    pendingTask = null;
    activeTask = null;
    return reason;
  }

  function snapshot() {
    return {
      pendingKey: pendingTask?.key ?? null,
      activeKey: activeTask?.key ?? null,
      pendingTask: pendingTask ? { ...pendingTask } : null,
      activeTask: activeTask ? { ...activeTask } : null,
    };
  }

  return {
    schedule,
    cancel,
    snapshot,
  };
}
