function positiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} 必须是正数。`);
  }
  return value;
}

export function createEstimatedPageLayout({ pageCount, width, height }) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new RangeError("pageCount 必须是正整数。");
  }
  positiveNumber(width, "width");
  positiveNumber(height, "height");

  return Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    width,
    height,
    measured: index === 0,
  }));
}

export function updatePageLayout(layout, pageNumber, { width, height }) {
  if (!Array.isArray(layout) || !layout.length) {
    throw new TypeError("layout 必须是非空数组。");
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > layout.length) {
    throw new RangeError("pageNumber 超出页面范围。");
  }
  positiveNumber(width, "width");
  positiveNumber(height, "height");

  const next = layout.slice();
  next[pageNumber - 1] = { pageNumber, width, height, measured: true };
  return next;
}

export function pageTopsFromLayout(layout, { start = 0, gap = 0 } = {}) {
  if (!Array.isArray(layout)) throw new TypeError("layout 必须是数组。");
  if (!Number.isFinite(start) || !Number.isFinite(gap) || gap < 0) {
    throw new RangeError("start 和 gap 必须是有效的布局数值。");
  }

  const tops = new Array(layout.length);
  let top = start;
  for (let index = 0; index < layout.length; index += 1) {
    tops[index] = top;
    top += positiveNumber(layout[index].height, "page height") + gap;
  }
  return tops;
}

export function findPageNumberAtOffset(pageTops, offset) {
  if (!pageTops.length) return 0;
  let low = 0;
  let high = pageTops.length - 1;
  let result = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (pageTops[middle] <= offset) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result + 1;
}

export function captureReadingAnchor({
  pageNumber,
  pageTop,
  pageHeight,
  scrollTop,
  viewportHeight,
  readingLineRatio = 0.38,
}) {
  positiveNumber(pageHeight, "pageHeight");
  const readingOffset = scrollTop + viewportHeight * readingLineRatio;
  const relativeOffset = Math.max(0, Math.min(1, (readingOffset - pageTop) / pageHeight));
  return { pageNumber, relativeOffset, readingLineRatio };
}

export function restoreReadingAnchor(anchor, {
  pageTop,
  pageHeight,
  viewportHeight,
}) {
  positiveNumber(pageHeight, "pageHeight");
  return Math.max(
    0,
    pageTop + pageHeight * anchor.relativeOffset -
      viewportHeight * anchor.readingLineRatio,
  );
}
