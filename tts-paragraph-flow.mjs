// tts-paragraph-flow.mjs — 流觞曲水的自然段模型与纯 crossing 状态机

import { bboxToTopLeft } from "./chunk-coordinate.mjs";
import {
  createReadableChunk,
  orderLinesForReading,
  segmentsToLines,
} from "./readable-chunk.mjs";
import { firstSentence } from "./tts-sentence.mjs";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function median(values = [], fallback = 0) {
  const ordered = values
    .map((value) => finiteNumber(value, Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!ordered.length) return fallback;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function unionBbox(items = []) {
  const boxes = items.map((item) => item?.bbox).filter(Boolean);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((box) => finiteNumber(box.x)));
  const y0 = Math.min(...boxes.map((box) => finiteNumber(box.y)));
  const x1 = Math.max(...boxes.map((box) => finiteNumber(box.x) + finiteNumber(box.width)));
  const y1 = Math.max(...boxes.map((box) => finiteNumber(box.y) + finiteNumber(box.height)));
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

function endsSentence(text = "") {
  return /[.!?。！？；;]["”’』」）》）\]]?$/u.test(String(text).trim());
}

function looksLikeHeading(text = "") {
  const clean = String(text).trim();
  if (!clean || clean.length > 100) return false;
  const letters = [...clean.matchAll(/\p{L}/gu)].length;
  if (!letters) return false;
  return clean === clean.toUpperCase() || /^(?:chapter|part|section)\b/iu.test(clean);
}

function rawColumnForLine(line, pageWidth) {
  const box = line?.bbox;
  if (!box || pageWidth <= 0) return 0;
  if (finiteNumber(box.width) >= pageWidth * 0.72) return -1;
  return finiteNumber(box.x) < pageWidth * 0.46 ? 0 : 1;
}

function columnForLine(line, pageWidth, twoColumn = false) {
  return twoColumn ? rawColumnForLine(line, pageWidth) : 0;
}

function lineMetrics(lines, pageWidth) {
  const height = Math.max(1, median(lines.map((line) => line?.bbox?.height), 12));
  const rawColumns = lines.map((line) => rawColumnForLine(line, pageWidth));
  const twoColumn = rawColumns.filter((column) => column === 0).length >= 4 &&
    rawColumns.filter((column) => column === 1).length >= 4;
  const byColumn = new Map();
  for (const line of lines) {
    const column = columnForLine(line, pageWidth, twoColumn);
    if (!byColumn.has(column)) byColumn.set(column, []);
    byColumn.get(column).push(line);
  }
  const columns = new Map();
  for (const [column, entries] of byColumn) {
    columns.set(column, {
      left: Math.min(...entries.map((line) => finiteNumber(line?.bbox?.x))),
      width: Math.max(1, median(entries.map((line) => line?.bbox?.width), pageWidth * 0.7)),
    });
  }
  return { height, columns, twoColumn };
}

function boundaryBefore(previous, current, {
  pageWidth,
  metrics,
} = {}) {
  if (!previous) return { split: true, confidence: 0.55, source: "page-start" };

  if (previous.paragraphId && current.paragraphId) {
    return previous.paragraphId === current.paragraphId
      ? { split: false, confidence: 1, source: "ocr-paragraph" }
      : { split: true, confidence: 1, source: "ocr-paragraph" };
  }

  const previousColumn = columnForLine(previous, pageWidth, metrics.twoColumn);
  const currentColumn = columnForLine(current, pageWidth, metrics.twoColumn);
  if (previousColumn !== currentColumn) {
    return { split: true, confidence: 0.98, source: "column-change" };
  }
  if (finiteNumber(current?.bbox?.y) < finiteNumber(previous?.bbox?.y) - metrics.height * 0.5) {
    return { split: true, confidence: 0.98, source: "column-reset" };
  }

  if (looksLikeHeading(previous.text) || looksLikeHeading(current.text)) {
    return { split: true, confidence: 0.9, source: "heading" };
  }

  const previousBottom = finiteNumber(previous?.bbox?.y) + finiteNumber(previous?.bbox?.height);
  const verticalGap = finiteNumber(current?.bbox?.y) - previousBottom;
  if (verticalGap > metrics.height * 0.8) {
    return { split: true, confidence: 0.88, source: "line-gap" };
  }

  const column = metrics.columns.get(currentColumn) ?? { left: 0, width: pageWidth };
  const indent = finiteNumber(current?.bbox?.x) - column.left;
  const indentThreshold = Math.max(10, pageWidth * 0.025);
  if (indent >= indentThreshold && endsSentence(previous.text)) {
    return { split: true, confidence: 0.82, source: "first-line-indent" };
  }

  const previousWidth = finiteNumber(previous?.bbox?.width);
  const currentAtBaseline = Math.abs(finiteNumber(current?.bbox?.x) - column.left) <= indentThreshold;
  if (
    endsSentence(previous.text) &&
    previousWidth < column.width * 0.74 &&
    currentAtBaseline
  ) {
    return { split: true, confidence: 0.74, source: "short-terminal-line" };
  }

  return { split: false, confidence: 0.5, source: "line-continuation" };
}

function createPassageFromLines(lines, {
  pageIndex,
  paragraphIndex,
  pageDimensions,
  boundary,
} = {}) {
  const text = lines.map((line) => String(line?.text ?? "").trim()).filter(Boolean).join(" ");
  const bbox = unionBbox(lines);
  const source = lines[0]?.source ?? "native-text";
  const base = createReadableChunk({
    pageIndex,
    chunkIndex: paragraphIndex,
    text,
    bbox,
    sourceSegmentIds: lines.flatMap((line) => line.sourceSegmentIds ?? []),
    source,
    pageDimensions: {
      ...pageDimensions,
      coordinateSystem: "top-down",
    },
    coordinateSystem: "top-down",
  });
  const paragraphKey = `${source}:${pageIndex}:paragraph:${paragraphIndex}`;
  const leadText = firstSentence(base.text);
  const leadBase = createReadableChunk({
    pageIndex,
    chunkIndex: paragraphIndex,
    text: leadText,
    bbox: lines[0]?.bbox ?? bbox,
    sourceSegmentIds: lines[0]?.sourceSegmentIds ?? [],
    source,
    pageDimensions: {
      ...pageDimensions,
      coordinateSystem: "top-down",
    },
    coordinateSystem: "top-down",
  });
  const fragment = {
    pageIndex,
    text: base.text,
    bbox: base.bbox,
    readingBbox: base.readingBbox,
    normalizedBbox: base.normalizedBbox,
    startLineIndex: 0,
    endLineIndex: Math.max(0, lines.length - 1),
    boundaryConfidence: boundary.confidence,
    boundarySource: boundary.source,
    continuesFromPrevious: false,
    continuesOnNext: false,
  };
  return {
    paragraphKey,
    paragraphIndex,
    source,
    text: base.text,
    languageHint: base.languageHint,
    role: base.role,
    priority: base.priority,
    qualityFlags: base.qualityFlags,
    fragments: [fragment],
    leadSentence: {
      key: `${paragraphKey}:lead`,
      text: leadText,
      pageIndex,
      source,
      bbox: leadBase.bbox,
      readingBbox: leadBase.readingBbox,
      normalizedBbox: leadBase.normalizedBbox,
      languageHint: leadBase.languageHint,
    },
    boundaryConfidence: boundary.confidence,
    boundarySource: boundary.source,
    crossPage: false,
  };
}

export function linesToParagraphPassages(lines = [], {
  pageIndex = 0,
  pageDimensions = null,
} = {}) {
  const pageWidth = Math.max(
    1,
    finiteNumber(pageDimensions?.width) ||
      Math.max(1, ...lines.map((line) => finiteNumber(line?.bbox?.x) + finiteNumber(line?.bbox?.width))),
  );
  const valid = lines.filter((line) => line?.text && line?.bbox);
  if (!valid.length) return [];
  const metrics = lineMetrics(valid, pageWidth);
  const groups = [];
  let group = [];
  let groupBoundary = { split: true, confidence: 0.55, source: "page-start" };

  const flush = () => {
    if (!group.length) return;
    groups.push(createPassageFromLines(group, {
      pageIndex,
      paragraphIndex: groups.length,
      pageDimensions,
      boundary: groupBoundary,
    }));
    group = [];
  };

  for (const line of valid) {
    const boundary = boundaryBefore(group.at(-1), line, {
      pageWidth,
      metrics,
    });
    if (group.length && boundary.split) {
      flush();
      groupBoundary = boundary;
    } else if (!group.length) {
      groupBoundary = boundary;
    }
    group.push(line);
  }
  flush();
  return groups;
}

function shouldJoinAcrossPages(previous, current) {
  if (!previous || !current || previous.source !== current.source) return false;
  if (previous.role !== "body" || current.role !== "body") return false;
  if (endsSentence(previous.text)) return false;
  const previousFragment = previous.fragments.at(-1);
  const currentFragment = current.fragments[0];
  const previousX = finiteNumber(previousFragment?.normalizedBbox?.x, -1);
  const currentX = finiteNumber(currentFragment?.normalizedBbox?.x, -1);
  const previousEnd = finiteNumber(previousFragment?.normalizedBbox?.y, -1) +
    finiteNumber(previousFragment?.normalizedBbox?.height);
  const currentStart = finiteNumber(currentFragment?.normalizedBbox?.y, 2);
  return previousX >= 0 &&
    currentX >= 0 &&
    Math.abs(previousX - currentX) <= 0.06 &&
    previousEnd >= 0.82 &&
    currentStart <= 0.18;
}

function joinAcrossPages(previous, current) {
  const previousFragments = previous.fragments.map((fragment, index, list) => (
    index === list.length - 1 ? { ...fragment, continuesOnNext: true } : fragment
  ));
  const currentFragments = current.fragments.map((fragment, index) => (
    index === 0 ? { ...fragment, continuesFromPrevious: true } : fragment
  ));
  return {
    ...previous,
    text: `${previous.text} ${current.text}`.replace(/\s+/gu, " ").trim(),
    leadSentence: {
      ...previous.leadSentence,
      text: firstSentence(`${previous.text} ${current.text}`),
    },
    fragments: [...previousFragments, ...currentFragments],
    crossPage: true,
  };
}

export function linkCrossPageParagraphs(passages = []) {
  const linked = [];
  for (const passage of passages) {
    const previous = linked.at(-1);
    const previousPage = previous?.fragments?.at(-1)?.pageIndex;
    const currentPage = passage?.fragments?.[0]?.pageIndex;
    if (
      Number.isInteger(previousPage) &&
      Number.isInteger(currentPage) &&
      currentPage === previousPage + 1 &&
      shouldJoinAcrossPages(previous, passage)
    ) {
      linked[linked.length - 1] = joinAcrossPages(previous, passage);
    } else {
      linked.push(passage);
    }
  }
  return linked.map((passage, paragraphIndex) => ({
    ...passage,
    paragraphIndex,
  }));
}

export function segmentsToParagraphPassages(segments = [], options = {}) {
  const byPage = new Map();
  for (const segment of segments) {
    const pageIndex = Math.max(0, Math.round(finiteNumber(segment?.pageIndex)));
    if (!byPage.has(pageIndex)) byPage.set(pageIndex, []);
    byPage.get(pageIndex).push(segment);
  }
  const passages = [];
  for (const [pageIndex, pageSegments] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const pageDimensions = options.pageDimensionsByPage?.get?.(pageIndex) ??
      options.pageDimensionsByPage?.[pageIndex] ??
      options.pageDimensions;
    const rawLines = segmentsToLines(pageSegments, {
      ...options,
      pageWidth: pageDimensions?.width ?? options.pageWidth,
    });
    const normalizedLines = rawLines.map((line) => ({
      ...line,
      bbox: bboxToTopLeft(line.bbox, pageDimensions, options.coordinateSystem),
    }));
    const ordered = orderLinesForReading(normalizedLines, {
      ...options,
      pageWidth: pageDimensions?.width ?? options.pageWidth,
      coordinateSystem: "top-down",
    });
    passages.push(...linesToParagraphPassages(ordered, {
      pageIndex,
      pageDimensions,
    }));
  }
  return linkCrossPageParagraphs(passages);
}

function pageMetricFor(pageMetrics, pageIndex) {
  return pageMetrics?.get?.(pageIndex) ??
    pageMetrics?.[pageIndex] ??
    null;
}

export function materializeParagraphBoundaries(passages = [], pageMetrics = new Map()) {
  return passages.flatMap((passage) => {
    const first = passage.fragments?.[0];
    const last = passage.fragments?.at(-1);
    const firstMetric = pageMetricFor(pageMetrics, first?.pageIndex);
    const lastMetric = pageMetricFor(pageMetrics, last?.pageIndex);
    if (!first?.normalizedBbox || !last?.normalizedBbox || !firstMetric || !lastMetric) {
      return [];
    }
    const start = finiteNumber(firstMetric.pageTop) +
      finiteNumber(first.normalizedBbox.y) * finiteNumber(firstMetric.pageHeight);
    const end = finiteNumber(lastMetric.pageTop) +
      (finiteNumber(last.normalizedBbox.y) + finiteNumber(last.normalizedBbox.height)) *
        finiteNumber(lastMetric.pageHeight);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    return [{
      ...passage,
      start,
      end,
    }];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}

function boundedHandled(keys, limit) {
  const unique = [...new Set(keys)];
  return unique.slice(Math.max(0, unique.length - limit));
}

export function createParagraphFlowState({
  contextKey = null,
  position = null,
  maxHandled = 512,
} = {}) {
  return {
    contextKey,
    position: Number.isFinite(Number(position)) ? Number(position) : null,
    preparedKey: null,
    handledParagraphKeys: [],
    maxHandled: Math.max(16, Math.round(finiteNumber(maxHandled, 512))),
  };
}

export function shouldPreserveParagraphFlowOnPageChange({
  enabled = false,
  tierKey = null,
  previousPage = 0,
  nextPage = 0,
  direction = 0,
  jumped = false,
} = {}) {
  return Boolean(
    enabled &&
    tierKey === "winding-stream" &&
    Number.isInteger(previousPage) &&
    previousPage > 0 &&
    nextPage === previousPage + 1 &&
    finiteNumber(direction) >= 0 &&
    !jumped
  );
}

export function isLargeParagraphReadingJump({
  scrollDelta = 0,
  viewportHeight = 0,
  minPixels = 180,
  viewportRatio = 0.45,
} = {}) {
  return Math.abs(finiteNumber(scrollDelta)) >= Math.max(
    Math.max(1, finiteNumber(minPixels, 180)),
    Math.max(0, finiteNumber(viewportHeight)) *
      Math.max(0, finiteNumber(viewportRatio, 0.45)),
  );
}

function normalizedWindowSources(windowSources = []) {
  return windowSources
    .map(({ pageNumber, source = "none", revision = 0 } = {}) => ({
      pageNumber: Math.max(0, Math.round(finiteNumber(pageNumber))),
      source: source ?? "none",
      revision: Math.max(0, Math.round(finiteNumber(revision))),
    }))
    .filter(({ pageNumber }) => pageNumber > 0)
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

function sameWindowSource(left, right) {
  return left?.source === right?.source && left?.revision === right?.revision;
}

function overlappingWindowChanged(previousSources, nextSources) {
  const previousByPage = new Map(
    previousSources.map((entry) => [entry.pageNumber, entry]),
  );
  const nextByPage = new Map(
    nextSources.map((entry) => [entry.pageNumber, entry]),
  );
  const overlappingPages = [...previousByPage.keys()]
    .filter((pageNumber) => nextByPage.has(pageNumber));
  if (!previousByPage.size && !nextByPage.size) return false;
  if (!overlappingPages.length) return true;
  return overlappingPages.some((pageNumber) => (
    !sameWindowSource(previousByPage.get(pageNumber), nextByPage.get(pageNumber))
  ));
}

export function createParagraphFlowContextKey({
  documentGeneration = 0,
  controllerGeneration = 0,
  contentRevision = 0,
} = {}) {
  return [
    Math.max(0, Math.round(finiteNumber(documentGeneration))),
    Math.max(0, Math.round(finiteNumber(controllerGeneration))),
    Math.max(0, Math.round(finiteNumber(contentRevision))),
  ].join(":");
}

export function advanceParagraphFlowContext(previousState, {
  documentGeneration = 0,
  controllerGeneration = 0,
  pageNumber = 0,
  windowSources = [],
} = {}) {
  const next = {
    documentGeneration: Math.max(0, Math.round(finiteNumber(documentGeneration))),
    controllerGeneration: Math.max(0, Math.round(finiteNumber(controllerGeneration))),
    pageNumber: Math.max(0, Math.round(finiteNumber(pageNumber))),
    windowSources: normalizedWindowSources(windowSources),
    contentRevision: Math.max(
      0,
      Math.round(finiteNumber(previousState?.contentRevision)),
    ),
  };
  const sameSession = Boolean(
    previousState &&
    previousState.documentGeneration === next.documentGeneration &&
    previousState.controllerGeneration === next.controllerGeneration
  );
  if (!sameSession) {
    next.contentRevision = 0;
  } else {
    const adjacentForward = next.pageNumber === previousState.pageNumber + 1;
    const samePage = next.pageNumber === previousState.pageNumber;
    const contentChanged = overlappingWindowChanged(
      normalizedWindowSources(previousState.windowSources),
      next.windowSources,
    );
    if ((!samePage && !adjacentForward) || contentChanged) {
      next.contentRevision += 1;
    }
  }
  return {
    state: next,
    key: createParagraphFlowContextKey(next),
  };
}

function nextPassage(passages, index) {
  const passage = passages[index + 1];
  return passage?.leadSentence?.text ? passage : null;
}

function bootstrapTarget(passages, position) {
  const containingIndex = passages.findIndex((passage) => (
    passage.start <= position && position < passage.end
  ));
  if (containingIndex >= 0) return nextPassage(passages, containingIndex);
  const upcomingIndex = passages.findIndex((passage) => passage.start > position);
  if (upcomingIndex <= 0) return null;
  return passages[upcomingIndex]?.leadSentence?.text
    ? passages[upcomingIndex]
    : null;
}

function prepareAction(target) {
  return {
    type: "prepare",
    key: target.leadSentence.key,
    paragraphKey: target.paragraphKey,
    target,
  };
}

export function advanceParagraphFlow(previousState, {
  contextKey,
  position,
  isPlaying = false,
  passages = [],
  readyPreparedKey = null,
  jumped = false,
} = {}) {
  const previous = previousState ?? createParagraphFlowState();
  const nextPosition = finiteNumber(position, previous.position ?? 0);
  let state = {
    ...previous,
    handledParagraphKeys: [...(previous.handledParagraphKeys ?? [])],
  };
  const actions = [];

  if (state.contextKey !== contextKey) {
    if (state.preparedKey) {
      actions.push({ type: "discard-prepared", key: state.preparedKey, reason: "context-changed" });
    }
    state = createParagraphFlowState({
      contextKey,
      position: nextPosition,
      maxHandled: state.maxHandled,
    });
    if (isPlaying && !jumped) {
      const target = bootstrapTarget(passages, nextPosition);
      if (target) {
        actions.push(prepareAction(target));
        state.preparedKey = target.leadSentence.key;
      }
    }
    return { state, actions };
  }

  if (!isPlaying || jumped) {
    if (state.preparedKey) {
      actions.push({
        type: "discard-prepared",
        key: state.preparedKey,
        reason: jumped ? "jumped" : "paused",
      });
    }
    state.preparedKey = null;
    state.position = nextPosition;
    return { state, actions };
  }

  const previousPosition = state.position;
  state.position = nextPosition;
  if (!Number.isFinite(previousPosition) || nextPosition <= previousPosition) {
    return { state, actions };
  }

  const events = [];
  passages.forEach((passage, index) => {
    if (previousPosition < passage.start && passage.start <= nextPosition) {
      events.push({ position: passage.start, type: "start", index });
    }
    if (previousPosition < passage.end && passage.end <= nextPosition) {
      events.push({ position: passage.end, type: "tail", index });
    }
  });
  events.sort((a, b) => a.position - b.position || (a.type === "tail" ? -1 : 1));

  for (const event of events) {
    const target = nextPassage(passages, event.index);
    if (!target || state.handledParagraphKeys.includes(target.paragraphKey)) continue;
    const targetKey = target.leadSentence.key;
    if (event.type === "start") {
      if (state.preparedKey && state.preparedKey !== targetKey) {
        actions.push({ type: "discard-prepared", key: state.preparedKey, reason: "target-changed" });
        state.preparedKey = null;
      }
      if (state.preparedKey !== targetKey) {
        actions.push(prepareAction(target));
        state.preparedKey = targetKey;
      }
      continue;
    }

    if (state.preparedKey === targetKey && readyPreparedKey === targetKey) {
      actions.push({
        type: "play-prepared",
        key: targetKey,
        paragraphKey: target.paragraphKey,
        target,
      });
    } else {
      actions.push({
        type: "discard-prepared",
        key: targetKey,
        reason: "late-or-missing",
        paragraphKey: target.paragraphKey,
      });
    }
    state.preparedKey = null;
    state.handledParagraphKeys.push(target.paragraphKey);
    state.handledParagraphKeys = boundedHandled(
      state.handledParagraphKeys,
      state.maxHandled,
    );
  }

  return { state, actions };
}
