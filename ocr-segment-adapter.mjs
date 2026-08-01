import { createTextSegment } from "./text-segment.mjs";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function cleanOcrItemText(item) {
  return String(item?.text ?? item?.symbols?.map((symbol) => symbol?.text ?? "").join("") ?? "")
    // Scanned book borders are commonly recognized as a pipe at the start or
    // end of every line. Remove boundary pipes while preserving real internal
    // column separators for the quality classifier.
    .trim()
    .replace(/^[|¦]+\s*/u, "")
    .replace(/\s*[|¦]+$/u, "")
    .trim();
}

function flattenBlockLines(blocks = []) {
  return blocks.flatMap((block, blockIndex) => {
    const directLines = Array.isArray(block?.lines) ? block.lines : [];
    const paragraphLines = Array.isArray(block?.paragraphs)
      ? block.paragraphs.flatMap((paragraph, paragraphIndex) => (
          Array.isArray(paragraph?.lines)
            ? paragraph.lines.map((line) => ({
                ...line,
                blockId: line?.blockId ?? `block:${blockIndex}`,
                paragraphId: line?.paragraphId ?? `block:${blockIndex}:paragraph:${paragraphIndex}`,
              }))
            : []
        ))
      : [];
    return paragraphLines.length
      ? paragraphLines
      : directLines.map((line) => ({
          ...line,
          blockId: line?.blockId ?? `block:${blockIndex}`,
        }));
  });
}

function flattenLineWords(lines = []) {
  return lines.flatMap((line) => (
    Array.isArray(line?.words)
      ? line.words.map((word) => ({
          ...word,
          blockId: word?.blockId ?? line?.blockId,
          paragraphId: word?.paragraphId ?? line?.paragraphId,
        }))
      : []
  ));
}

export function bboxFromOcrBox(item = {}) {
  const box = item.bbox ?? item;
  const x0 = finiteNumber(box.x0 ?? box.left ?? box.x ?? 0);
  const y0 = finiteNumber(box.y0 ?? box.top ?? box.y ?? 0);
  const x1 = finiteNumber(
    box.x1 ??
      (Number.isFinite(Number(box.right)) ? box.right : null) ??
      (Number.isFinite(Number(box.width)) ? x0 + Number(box.width) : x0),
    x0,
  );
  const y1 = finiteNumber(
    box.y1 ??
      (Number.isFinite(Number(box.bottom)) ? box.bottom : null) ??
      (Number.isFinite(Number(box.height)) ? y0 + Number(box.height) : y0),
    y0,
  );
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

export function normalizeOcrResult(result = {}) {
  const data = result?.data ?? result ?? {};
  const blocks = Array.isArray(result?.blocks)
    ? result.blocks
    : Array.isArray(data.blocks)
      ? data.blocks
      : [];
  const blockLines = flattenBlockLines(blocks);
  const lines = blockLines.length
    ? blockLines
    : Array.isArray(result?.lines) && result.lines.length
      ? result.lines
    : Array.isArray(data.lines) && data.lines.length
      ? data.lines
      : [];
  const blockWords = flattenLineWords(blockLines);
  const words = blockWords.length
    ? blockWords
    : Array.isArray(result?.words) && result.words.length
      ? result.words
    : Array.isArray(data.words) && data.words.length
      ? data.words
      : flattenLineWords(lines);
  return {
    text: String(result?.text ?? data.text ?? ""),
    pageDimensions: result?.pageDimensions ?? data.pageDimensions ?? null,
    blocks,
    words,
    lines,
  };
}

export function pointSegmentPreferenceForOcrLanguageSet(languageSet = "") {
  return /(?:^|\+)(?:chi_sim|chi_tra|jpn)(?:\+|$)/u.test(String(languageSet))
    ? "lines"
    : "words";
}

export function segmentsFromOcrResult({
  documentId = null,
  pageIndex = 0,
  result,
  source = "ocr",
  prefer = "lines",
} = {}) {
  const normalized = normalizeOcrResult(result);
  const candidates = prefer === "words" || !normalized.lines.length
    ? normalized.words
    : normalized.lines;
  const segments = [];

  for (const item of candidates) {
    const text = cleanOcrItemText(item);
    if (!text) continue;
    const bbox = bboxFromOcrBox(item);
    if (bbox.width <= 0 && bbox.height <= 0) continue;
    segments.push(createTextSegment({
      documentId,
      pageIndex,
      segmentIndex: segments.length,
      text,
      bbox,
      source,
      confidence: finiteNumber(item.confidence ?? item.conf ?? 1, 1) / (finiteNumber(item.confidence ?? item.conf ?? 1, 1) > 1 ? 100 : 1),
      paragraphId: item.paragraphId,
      blockId: item.blockId,
      hasEOL: true,
    }));
  }

  return segments;
}
