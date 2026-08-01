export function normalizeLanguageHint(text = "") {
  const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  const hasLatin = /\p{Script=Latin}/u.test(text);
  if (hasCjk && hasLatin) return "mixed";
  if (hasCjk) return "cjk";
  if (hasLatin) return "latin";
  return "unknown";
}

export function createTextSegment({
  documentId = null,
  pageIndex,
  segmentIndex,
  text,
  bbox = null,
  source = "native-text",
  confidence = 1,
  paragraphId = null,
  blockId = null,
  hasEOL = false,
  fontName = null,
  direction = null,
} = {}) {
  const cleanText = typeof text === "string" ? text.trim() : "";
  const safeBbox = bbox && typeof bbox === "object"
    ? {
        x: Number.isFinite(Number(bbox.x)) ? Number(bbox.x) : 0,
        y: Number.isFinite(Number(bbox.y)) ? Number(bbox.y) : 0,
        width: Math.max(0, Number.isFinite(Number(bbox.width)) ? Number(bbox.width) : 0),
        height: Math.max(0, Number.isFinite(Number(bbox.height)) ? Number(bbox.height) : 0),
      }
    : null;

  return {
    documentId,
    pageIndex: Math.max(0, Math.round(Number(pageIndex) || 0)),
    segmentIndex: Math.max(0, Math.round(Number(segmentIndex) || 0)),
    text: cleanText,
    languageHint: normalizeLanguageHint(cleanText),
    bbox: safeBbox,
    yStart: safeBbox ? safeBbox.y : null,
    yEnd: safeBbox ? safeBbox.y + safeBbox.height : null,
    source,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    paragraphId: paragraphId === null || paragraphId === undefined
      ? null
      : String(paragraphId),
    blockId: blockId === null || blockId === undefined ? null : String(blockId),
    hasEOL: Boolean(hasEOL),
    fontName: typeof fontName === "string" && fontName ? fontName : null,
    direction: typeof direction === "string" && direction ? direction : null,
  };
}

export function segmentsFromPdfTextContent({
  documentId = null,
  pageIndex,
  textContent,
  source = "native-text",
  viewport = null,
} = {}) {
  const items = Array.isArray(textContent?.items) ? textContent.items : [];
  const segments = [];

  for (const item of items) {
    const text = typeof item?.str === "string" ? item.str : "";
    if (!text.trim()) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    const width = Number(item.width) || 0;
    const height = Number(item.height) || Math.abs(Number(transform[3]) || 0);
    let bbox = { x, y, width, height };
    if (typeof viewport?.convertToViewportRectangle === "function") {
      const rectangle = viewport.convertToViewportRectangle([
        x,
        y,
        x + width,
        y + height,
      ]);
      if (Array.isArray(rectangle) && rectangle.length >= 4) {
        const [x0, y0, x1, y1] = rectangle.map((value) => Number(value) || 0);
        bbox = {
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          width: Math.abs(x1 - x0),
          height: Math.abs(y1 - y0),
        };
      }
    }
    segments.push(createTextSegment({
      documentId,
      pageIndex,
      segmentIndex: segments.length,
      text,
      bbox,
      source,
      confidence: 1,
      hasEOL: item?.hasEOL,
      fontName: item?.fontName,
      direction: item?.dir,
    }));
  }

  return segments;
}

export function plainTextFromSegments(segments = []) {
  return segments
    .map((segment) => (typeof segment?.text === "string" ? segment.text : ""))
    .filter(Boolean)
    .join(" ");
}
