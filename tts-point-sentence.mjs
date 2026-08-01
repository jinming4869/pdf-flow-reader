// tts-point-sentence.mjs — deterministic sentence geometry for point-to-read

import { bboxToTopLeft, relativeBbox } from "./chunk-coordinate.mjs";
import {
  createReadableChunk,
  orderLinesForReading,
  segmentsToLines,
} from "./readable-chunk.mjs";
import { normalizePdfArtifacts } from "./text-cleaner.mjs";
import { splitSentenceRanges } from "./tts-sentence.mjs";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unionBboxes(boxes = []) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  const x0 = Math.min(...valid.map((box) => finiteNumber(box.x)));
  const y0 = Math.min(...valid.map((box) => finiteNumber(box.y)));
  const x1 = Math.max(...valid.map((box) => finiteNumber(box.x) + finiteNumber(box.width)));
  const y1 = Math.max(...valid.map((box) => finiteNumber(box.y) + finiteNumber(box.height)));
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

function stableHash(value = "") {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function measuredPageWidth(lines = [], pageDimensions = null, pageWidth = null) {
  return Math.max(
    1,
    finiteNumber(pageWidth) ||
      finiteNumber(pageDimensions?.width) ||
      Math.max(1, ...lines.map((line) => (
        finiteNumber(line?.bbox?.x) + finiteNumber(line?.bbox?.width)
      ))),
  );
}

function readingStreams(lines = [], {
  pageDimensions = null,
  pageWidth = null,
  twoColumnMinLines = 4,
  coordinateSystem = "top-down",
} = {}) {
  const width = measuredPageWidth(lines, pageDimensions, pageWidth);
  const middle = width / 2;
  const left = lines.filter((line) => finiteNumber(line?.bbox?.x) < middle * 0.92);
  const right = lines.filter((line) => finiteNumber(line?.bbox?.x) >= middle * 0.92);
  const twoColumn = left.length >= twoColumnMinLines && right.length >= twoColumnMinLines;
  const ordered = orderLinesForReading(lines, {
    pageWidth: width,
    twoColumnMinLines,
    coordinateSystem,
  });
  if (!twoColumn) return [{ columnIndex: null, lines: ordered }];
  return [
    {
      columnIndex: 0,
      lines: ordered.filter((line) => finiteNumber(line?.bbox?.x) < middle),
    },
    {
      columnIndex: 1,
      lines: ordered.filter((line) => finiteNumber(line?.bbox?.x) >= middle),
    },
  ].filter((stream) => stream.lines.length);
}

function boundarySeparator(previous = "", current = "") {
  const previousCharacter = previous.at(-1) ?? "";
  const currentCharacter = current[0] ?? "";
  const isCjk = (character) => (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)
  );
  const isCjkFlowEnd = (character) => /[、。，！？；：」』》〉）】]/u.test(character);
  if ((isCjk(previousCharacter) || isCjkFlowEnd(previousCharacter)) && isCjk(currentCharacter)) {
    return "";
  }
  return " ";
}

function normalizePointLine(text = "") {
  const cjk = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
  return normalizePdfArtifacts(text)
    .replace(new RegExp(`([${cjk}])\\s+(?=[${cjk}、。，！？；：])`, "gu"), "$1")
    .replace(new RegExp(`([、。，！？；：])\\s+(?=[${cjk}])`, "gu"), "$1");
}

function streamTextAndSpans(lines = []) {
  let text = "";
  const spans = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineText = normalizePointLine(line?.text ?? "");
    if (!lineText) continue;
    if (text) text += boundarySeparator(text, lineText);
    const start = text.length;
    text += lineText;
    spans.push({
      line,
      lineIndex,
      start,
      end: text.length,
      text: lineText,
    });
  }
  return { text, spans };
}

function fragmentForIntersection(span, range, {
  pageDimensions,
  coordinateSystem,
} = {}) {
  let start = Math.max(range.start, span.start) - span.start;
  let end = Math.min(range.end, span.end) - span.start;
  while (start < end && /\s/u.test(span.text[start])) start += 1;
  while (end > start && /\s/u.test(span.text[end - 1])) end -= 1;
  if (end <= start || !span.line?.bbox) return null;

  const lineLength = Math.max(1, span.text.length);
  const startRatio = start / lineLength;
  const endRatio = end / lineLength;
  const lineBox = span.line.bbox;
  const rtl = span.line.direction === "rtl";
  const xRatio = rtl ? 1 - endRatio : startRatio;
  const bbox = {
    x: finiteNumber(lineBox.x) + finiteNumber(lineBox.width) * xRatio,
    y: finiteNumber(lineBox.y),
    width: Math.max(0, finiteNumber(lineBox.width) * (endRatio - startRatio)),
    height: Math.max(0, finiteNumber(lineBox.height)),
  };
  const readingBbox = bboxToTopLeft(bbox, pageDimensions, coordinateSystem);
  return {
    text: span.text.slice(start, end),
    lineIndex: span.lineIndex,
    bbox,
    readingBbox,
    normalizedBbox: relativeBbox(readingBbox, pageDimensions),
    sourceSegmentIds: [...(span.line.sourceSegmentIds ?? [])],
  };
}

function targetFromRange(range, spans, {
  documentId = null,
  pageIndex = 0,
  targetIndex = 0,
  pageDimensions = null,
  coordinateSystem = "top-down",
  columnIndex = null,
} = {}) {
  const fragments = spans
    .filter((span) => span.end > range.start && span.start < range.end)
    .map((span) => fragmentForIntersection(span, range, {
      pageDimensions,
      coordinateSystem,
    }))
    .filter(Boolean);
  if (!fragments.length) return null;

  const sourceLines = spans.filter((span) => (
    span.end > range.start && span.start < range.end
  ));
  const sourceSegmentIds = [...new Set(
    fragments.flatMap((fragment) => fragment.sourceSegmentIds),
  )];
  const source = sourceLines[0]?.line?.source ?? "native-text";
  const text = normalizePointLine(range.text);
  if (!text) return null;
  const bbox = unionBboxes(fragments.map((fragment) => fragment.bbox));
  const base = createReadableChunk({
    documentId,
    pageIndex,
    chunkIndex: targetIndex,
    text,
    bbox,
    sourceSegmentIds,
    source,
    pageDimensions,
    coordinateSystem,
  });
  const readableBase = base.role === "heading" && !/\p{Script=Latin}/u.test(text)
    ? { ...base, role: "body", priority: 1 }
    : base;
  const geometryKey = fragments.map((fragment) => {
    const box = fragment.bbox;
    return [box.x, box.y, box.width, box.height].map((value) => finiteNumber(value).toFixed(3)).join(",");
  }).join(";");
  const speechKey = `point:${pageIndex}:${source}:${stableHash([
    documentId ?? "document",
    text,
    sourceSegmentIds.join(","),
    geometryKey,
  ].join("|"))}`;
  return {
    ...readableBase,
    key: speechKey,
    speechKey,
    targetIndex,
    sentenceIndex: targetIndex,
    complete: true,
    columnIndex,
    fragments,
  };
}

export function createPointSentenceTargets(segments = [], options = {}) {
  const byPage = new Map();
  for (const segment of segments) {
    if (!segment?.text || !segment?.bbox) continue;
    const pageIndex = Math.max(0, Math.round(finiteNumber(segment.pageIndex)));
    if (!byPage.has(pageIndex)) byPage.set(pageIndex, []);
    byPage.get(pageIndex).push(segment);
  }

  const targets = [];
  for (const [pageIndex, pageSegments] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const pageDimensions = typeof options.pageDimensionsForPage === "function"
      ? options.pageDimensionsForPage(pageIndex)
      : options.pageDimensions ?? null;
    const coordinateSystem = options.coordinateSystem ?? pageDimensions?.coordinateSystem ?? "top-down";
    const pageWidth = finiteNumber(options.pageWidth) > 0
      ? finiteNumber(options.pageWidth)
      : finiteNumber(pageDimensions?.width) > 0
        ? finiteNumber(pageDimensions.width)
        : null;
    const lines = segmentsToLines(pageSegments, {
      ...options,
      pageWidth,
      coordinateSystem,
    });
    const streams = readingStreams(lines, {
      ...options,
      pageDimensions,
      pageWidth,
      coordinateSystem,
    });

    let sentenceIndex = 0;
    for (const stream of streams) {
      const assembled = streamTextAndSpans(stream.lines);
      const completeRanges = splitSentenceRanges(assembled.text).filter((range) => range.complete);
      for (const range of completeRanges) {
        const target = targetFromRange(range, assembled.spans, {
          documentId: pageSegments[0]?.documentId ?? options.documentId ?? null,
          pageIndex,
          targetIndex: sentenceIndex,
          pageDimensions,
          coordinateSystem,
          columnIndex: stream.columnIndex,
        });
        if (!target) continue;
        targets.push(target);
        sentenceIndex += 1;
      }
    }
  }

  return targets.map((target, chunkIndex) => ({ ...target, chunkIndex }));
}

function distanceToBox(x, y, box) {
  if (!box) return Number.POSITIVE_INFINITY;
  const left = finiteNumber(box.x);
  const top = finiteNumber(box.y);
  const right = left + finiteNumber(box.width);
  const bottom = top + finiteNumber(box.height);
  const dx = x < left ? left - x : x > right ? x - right : 0;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return Math.hypot(dx, dy);
}

export function pickPointSentence(targets = [], {
  x,
  y,
  maxDistance = 0.035,
  pageIndex = null,
} = {}) {
  const pointX = Number(x);
  const pointY = Number(y);
  if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return null;
  const safeDistance = Math.max(0, finiteNumber(maxDistance, 0.035));
  const candidates = targets.filter((target) => (
    target &&
    (pageIndex === null || pageIndex === undefined || target.pageIndex === pageIndex) &&
    Array.isArray(target.fragments) &&
    target.fragments.some((fragment) => fragment?.normalizedBbox)
  ));
  const columnIndexes = new Set(candidates.map((target) => target.columnIndex).filter(Number.isInteger));
  const guardedColumn = columnIndexes.has(0) && columnIndexes.has(1)
    ? (pointX < 0.5 ? 0 : 1)
    : null;
  const ranked = candidates
    .filter((target) => guardedColumn === null || target.columnIndex === guardedColumn)
    .map((target, order) => {
      const distances = target.fragments.map((fragment) => (
        distanceToBox(pointX, pointY, fragment.normalizedBbox)
      ));
      const distance = Math.min(...distances);
      const exactAreas = target.fragments
        .filter((fragment) => distanceToBox(pointX, pointY, fragment.normalizedBbox) === 0)
        .map((fragment) => (
          finiteNumber(fragment.normalizedBbox.width) * finiteNumber(fragment.normalizedBbox.height)
        ));
      return {
        target,
        order,
        distance,
        exactArea: exactAreas.length ? Math.min(...exactAreas) : Number.POSITIVE_INFINITY,
      };
    })
    .filter((entry) => entry.distance <= safeDistance)
    .sort((a, b) => (
      a.distance - b.distance || a.exactArea - b.exactArea || a.order - b.order
    ));
  return ranked[0]?.target ?? null;
}
