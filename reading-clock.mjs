export function readingLineOffset({ scrollTop = 0, viewportHeight = 0, ratio = 0.38 } = {}) {
  const safeScrollTop = Math.max(0, Number(scrollTop) || 0);
  const safeViewportHeight = Math.max(0, Number(viewportHeight) || 0);
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  return safeScrollTop + safeViewportHeight * safeRatio;
}

export function createReadingClockSnapshot({
  isPlaying = false,
  speedPxPerSecond = 0,
  scrollTop = 0,
  viewportHeight = 0,
  scrollHeight = 0,
  currentPageIndex = 0,
  readingLineRatio = 0.38,
  updatedAt = Date.now(),
} = {}) {
  const safeScrollTop = Math.max(0, Number(scrollTop) || 0);
  const safeViewportHeight = Math.max(0, Number(viewportHeight) || 0);
  const safeScrollHeight = Math.max(safeViewportHeight, Number(scrollHeight) || 0);
  const maximumScroll = Math.max(1, safeScrollHeight - safeViewportHeight);
  return {
    isPlaying: Boolean(isPlaying),
    speedPxPerSecond: Math.max(0, Number(speedPxPerSecond) || 0),
    scrollTop: safeScrollTop,
    viewportHeight: safeViewportHeight,
    scrollHeight: safeScrollHeight,
    currentPageIndex: Math.max(0, Math.round(Number(currentPageIndex) || 0)),
    readingLineY: readingLineOffset({
      scrollTop: safeScrollTop,
      viewportHeight: safeViewportHeight,
      ratio: readingLineRatio,
    }),
    progressRatio: Math.max(0, Math.min(1, safeScrollTop / maximumScroll)),
    updatedAt,
  };
}

export function hasReadingClockAdvanced(previous, next, epsilon = 0.001) {
  if (!previous || !next) return Boolean(next);
  return Math.abs((next.progressRatio ?? 0) - (previous.progressRatio ?? 0)) > epsilon ||
    next.currentPageIndex !== previous.currentPageIndex ||
    next.isPlaying !== previous.isPlaying ||
    next.speedPxPerSecond !== previous.speedPxPerSecond;
}
