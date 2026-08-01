import { enrichChunkCoordinates } from "./chunk-coordinate.mjs";
import { normalizeLanguageHint } from "./text-segment.mjs";
import {
  cleanReadableLine,
  isLikelyRunningHeader,
  normalizePdfArtifacts,
} from "./text-cleaner.mjs";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unionBbox(items = []) {
  const boxes = items.map((item) => item?.bbox).filter(Boolean);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((box) => finiteNumber(box.x)));
  const y0 = Math.min(...boxes.map((box) => finiteNumber(box.y)));
  const x1 = Math.max(...boxes.map((box) => finiteNumber(box.x) + finiteNumber(box.width)));
  const y1 = Math.max(...boxes.map((box) => finiteNumber(box.y) + finiteNumber(box.height)));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

function lineFromSegments(segments) {
  const ordered = [...segments].sort((a, b) => finiteNumber(a?.bbox?.x) - finiteNumber(b?.bbox?.x));
  const text = cleanReadableLine(ordered.map((segment) => segment.text).join(" "));
  const bbox = unionBbox(ordered);
  const paragraphIds = [...new Set(
    ordered.map((segment) => segment.paragraphId).filter((value) => value !== null && value !== undefined),
  )];
  const blockIds = [...new Set(
    ordered.map((segment) => segment.blockId).filter((value) => value !== null && value !== undefined),
  )];
  return {
    text,
    bbox,
    pageIndex: ordered[0]?.pageIndex ?? 0,
    sourceSegmentIds: ordered.map((segment) => segment.segmentIndex),
    source: ordered[0]?.source ?? "native-text",
    confidence: Math.min(...ordered.map((segment) => finiteNumber(segment.confidence, 1))),
    paragraphId: paragraphIds.length === 1 ? paragraphIds[0] : null,
    blockId: blockIds.length === 1 ? blockIds[0] : null,
    hasEOL: ordered.some((segment) => segment.hasEOL),
    fontNames: [...new Set(ordered.map((segment) => segment.fontName).filter(Boolean))],
    direction: ordered.find((segment) => segment.direction)?.direction ?? null,
  };
}

function splitLineSegments(segments = [], {
  pageWidth = null,
  maxHorizontalGap = null,
} = {}) {
  const ordered = [...segments].sort((a, b) => finiteNumber(a?.bbox?.x) - finiteNumber(b?.bbox?.x));
  if (ordered.length < 2) return ordered.length ? [ordered] : [];
  const measuredWidth = finiteNumber(pageWidth) || Math.max(
    1,
    ...ordered.map((segment) => finiteNumber(segment?.bbox?.x) + finiteNumber(segment?.bbox?.width)),
  );
  const threshold = finiteNumber(maxHorizontalGap) > 0
    ? finiteNumber(maxHorizontalGap)
    : Math.max(36, measuredWidth * 0.08);
  const middle = measuredWidth / 2;
  const centerGutterThreshold = Math.max(12, measuredWidth * 0.025);
  const clusters = [];
  for (const segment of ordered) {
    const previous = clusters.at(-1)?.at(-1);
    const previousEnd = previous
      ? finiteNumber(previous?.bbox?.x) + finiteNumber(previous?.bbox?.width)
      : null;
    const gap = previousEnd === null
      ? 0
      : finiteNumber(segment?.bbox?.x) - previousEnd;
    const crossesCenterGutter = Boolean(
      previousEnd !== null &&
      previousEnd < middle &&
      finiteNumber(segment?.bbox?.x) > middle &&
      gap > centerGutterThreshold
    );
    if (!clusters.length || gap > threshold || crossesCenterGutter) {
      clusters.push([segment]);
    } else {
      clusters.at(-1).push(segment);
    }
  }
  return clusters;
}

export function segmentsToLines(segments = [], {
  lineTolerance = 8,
  coordinateSystem = "top-down",
  pageWidth = null,
  maxHorizontalGap = null,
} = {}) {
  const valid = segments.filter((segment) => segment?.text && segment?.bbox);
  const sorted = [...valid].sort((a, b) => {
    const ay = finiteNumber(a.bbox.y);
    const by = finiteNumber(b.bbox.y);
    return coordinateSystem === "pdf" ? by - ay : ay - by;
  });
  const groups = [];
  for (const segment of sorted) {
    const y = finiteNumber(segment.bbox.y);
    let group = groups.find((candidate) => Math.abs(candidate.y - y) <= lineTolerance);
    if (!group) {
      group = { y, segments: [] };
      groups.push(group);
    }
    group.segments.push(segment);
    group.y = (group.y * (group.segments.length - 1) + y) / group.segments.length;
  }
  return groups
    .flatMap((group) => splitLineSegments(group.segments, {
      pageWidth,
      maxHorizontalGap,
    }))
    .map((group) => lineFromSegments(group))
    .filter((line) => line.text);
}

export function orderLinesForReading(lines = [], { pageWidth = null, twoColumnMinLines = 4, coordinateSystem = "top-down" } = {}) {
  const measuredWidth = finiteNumber(pageWidth) || Math.max(
    1,
    ...lines.map((line) => finiteNumber(line.bbox?.x) + finiteNumber(line.bbox?.width)),
  );
  const middle = measuredWidth / 2;
  const bodyLines = lines.filter((line) => line.bbox && line.text.trim().length > 0);
  const left = bodyLines.filter((line) => finiteNumber(line.bbox.x) < middle * 0.92);
  const right = bodyLines.filter((line) => finiteNumber(line.bbox.x) >= middle * 0.92);
  const likelyTwoColumn = left.length >= twoColumnMinLines && right.length >= twoColumnMinLines;
  const byY = (a, b) => {
    const ay = finiteNumber(a.bbox?.y);
    const by = finiteNumber(b.bbox?.y);
    return coordinateSystem === "pdf" ? by - ay : ay - by;
  };
  if (!likelyTwoColumn) return [...lines].sort(byY);

  return [
    ...lines.filter((line) => finiteNumber(line.bbox?.x) < middle).sort(byY),
    ...lines.filter((line) => finiteNumber(line.bbox?.x) >= middle).sort(byY),
  ];
}

export function classifyReadableText(text = "", { bbox = null, pageDimensions = null } = {}) {
  const clean = normalizePdfArtifacts(text);
  if (!clean) return "unknown";
  const letters = [...clean.matchAll(/[\p{L}]/gu)].length;
  const digits = [...clean.matchAll(/[\p{N}]/gu)].length;
  const symbols = [...clean.matchAll(/[=+*/<>|_{}[\]$%#@~^]/g)].length;
  const pageHeight = finiteNumber(pageDimensions?.height);
  const y = finiteNumber(bbox?.y);
  const nearBottom = pageHeight > 0 && y / pageHeight > 0.78;
  if (/^(references|bibliography|works cited)\b/i.test(clean)) return "reference";
  if (/\b(?:doi|https?:\/\/|www\.|dataverse|replication sets?|appendix)\b/i.test(clean)) {
    return nearBottom || clean.length < 260 ? "footnote" : "reference";
  }
  if (/^(?:\d+|[*†‡§])\s+[A-Z]/.test(clean) && nearBottom && clean.length < 420) return "footnote";
  if (symbols >= 4 && symbols > letters * 0.35) return "formula";
  if (letters === 0 && (digits > 0 || symbols > 0)) return "table";
  if (digits + symbols > letters * 1.2 && clean.length < 120) return "table";
  if (clean.length <= 90 && letters > 0 && clean === clean.toUpperCase()) return "heading";
  return "body";
}

export function priorityForRole(role = "body") {
  switch (role) {
    case "body": return 1;
    case "heading": return 0.85;
    case "footnote": return 0.38;
    case "reference": return 0.3;
    case "formula": return 0.22;
    case "table": return 0.2;
    default: return 0.45;
  }
}

export function qualityFlagsForChunk(text = "", role = "body") {
  const flags = [];
  if (["table", "formula", "footnote", "reference"].includes(role)) flags.push(`role:${role}`);
  const clean = normalizePdfArtifacts(text);
  if (/[=+*/<>|_{}[\]$%#@~^]/.test(clean)) flags.push("symbol-heavy");
  if (/\b(?:doi|isbn|issn|dataverse|replication sets?)\b/i.test(clean) || /https?:\/\//i.test(clean)) flags.push("bibliographic");
  if ((clean.match(/\d/g) ?? []).length > (clean.match(/[\p{L}]/gu) ?? []).length) flags.push("number-heavy");
  return flags;
}

export function createReadableChunk({
  documentId = null,
  pageIndex = 0,
  chunkIndex = 0,
  text = "",
  bbox = null,
  sourceSegmentIds = [],
  source = "native-text",
  role = null,
  priority = null,
  pageDimensions = null,
  coordinateSystem = null,
} = {}) {
  const cleanText = normalizePdfArtifacts(text);
  const safeBbox = bbox && typeof bbox === "object"
    ? {
        x: finiteNumber(bbox.x),
        y: finiteNumber(bbox.y),
        width: Math.max(0, finiteNumber(bbox.width)),
        height: Math.max(0, finiteNumber(bbox.height)),
      }
    : null;
  const topLeftBbox = enrichChunkCoordinates({ bbox: safeBbox }, { pageDimensions, coordinateSystem }).readingBbox;
  const resolvedRole = role ?? classifyReadableText(cleanText, { bbox: topLeftBbox, pageDimensions });
  const resolvedPriority = priority ?? priorityForRole(resolvedRole);
  return enrichChunkCoordinates({
    documentId,
    pageIndex: Math.max(0, Math.round(finiteNumber(pageIndex))),
    chunkIndex: Math.max(0, Math.round(finiteNumber(chunkIndex))),
    text: cleanText,
    languageHint: normalizeLanguageHint(cleanText),
    bbox: safeBbox,
    sourceSegmentIds: [...sourceSegmentIds],
    source,
    role: resolvedRole,
    priority: Math.max(0, Math.min(1, finiteNumber(resolvedPriority, 1))),
    qualityFlags: qualityFlagsForChunk(cleanText, resolvedRole),
  }, { pageDimensions, coordinateSystem });
}

function shouldFlush(text, { minChars, maxChars }) {
  if (!text) return false;
  if (text.length >= maxChars) return true;
  return text.length >= minChars && /[.!?。！？；;]["”')\]]?$/u.test(text);
}

export function linesToReadableChunks(lines = [], {
  documentId = null,
  pageIndex = 0,
  minChars = 120,
  maxChars = 420,
  repeatedLines = new Set(),
  pageDimensions = null,
  coordinateSystem = null,
} = {}) {
  const chunks = [];
  let bufferText = "";
  let bufferLines = [];

  const flush = () => {
    const text = normalizePdfArtifacts(bufferText);
    if (!text) {
      bufferText = "";
      bufferLines = [];
      return;
    }
    const bbox = unionBbox(bufferLines);
    chunks.push(createReadableChunk({
      documentId,
      pageIndex,
      chunkIndex: chunks.length,
      text,
      bbox,
      sourceSegmentIds: bufferLines.flatMap((line) => line.sourceSegmentIds ?? []),
      source: bufferLines[0]?.source ?? "native-text",
      pageDimensions,
      coordinateSystem,
    }));
    bufferText = "";
    bufferLines = [];
  };

  for (const line of lines) {
    const text = cleanReadableLine(line?.text ?? "");
    if (!text || isLikelyRunningHeader(text, { repeatedLines })) continue;
    const nextText = normalizePdfArtifacts(`${bufferText} ${text}`);
    if (bufferText && nextText.length > maxChars) flush();
    bufferText = normalizePdfArtifacts(`${bufferText} ${text}`);
    bufferLines.push(line);
    if (shouldFlush(bufferText, { minChars, maxChars })) flush();
  }
  flush();
  return chunks;
}

export function segmentsToReadableChunks(segments = [], options = {}) {
  const byPage = new Map();
  for (const segment of segments) {
    const pageIndex = Math.max(0, Math.round(finiteNumber(segment?.pageIndex)));
    if (!byPage.has(pageIndex)) byPage.set(pageIndex, []);
    byPage.get(pageIndex).push(segment);
  }
  const chunks = [];
  for (const [pageIndex, pageSegments] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const lines = segmentsToLines(pageSegments, options);
    const orderedLines = orderLinesForReading(lines, options);
    const pageChunks = linesToReadableChunks(orderedLines, { ...options, pageIndex });
    for (const chunk of pageChunks) {
      chunks.push({ ...chunk, chunkIndex: chunks.length });
    }
  }
  return chunks;
}
