import test from "node:test";
import assert from "node:assert/strict";

import {
  createTextSegment,
  normalizeLanguageHint,
  plainTextFromSegments,
  segmentsFromPdfTextContent,
} from "../text-segment.mjs";

test("normalizeLanguageHint separates cjk, latin and mixed text", () => {
  assert.equal(normalizeLanguageHint("庄子"), "cjk");
  assert.equal(normalizeLanguageHint("Brahms"), "latin");
  assert.equal(normalizeLanguageHint("庄子 Brahms"), "mixed");
  assert.equal(normalizeLanguageHint("123"), "unknown");
});

test("createTextSegment normalizes bbox and y range", () => {
  const segment = createTextSegment({
    pageIndex: 2,
    segmentIndex: 3,
    text: "  hello  ",
    bbox: { x: 10, y: 20, width: 30, height: 12 },
  });
  assert.equal(segment.text, "hello");
  assert.equal(segment.yStart, 20);
  assert.equal(segment.yEnd, 32);
  assert.equal(segment.languageHint, "latin");
});

test("segmentsFromPdfTextContent converts PDF.js text items into future TTS segments", () => {
  const segments = segmentsFromPdfTextContent({
    documentId: "doc_a",
    pageIndex: 1,
    textContent: {
      items: [
        { str: "Hello", transform: [1, 0, 0, 10, 12, 34], width: 42, height: 10 },
        { str: " ", transform: [1, 0, 0, 10, 60, 34], width: 4, height: 10 },
        { str: "世界", transform: [1, 0, 0, 11, 12, 18], width: 26 },
      ],
    },
  });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].bbox.x, 12);
  assert.equal(segments[0].hasEOL, false);
  assert.equal(segments[1].bbox.height, 11);
  assert.equal(plainTextFromSegments(segments), "Hello 世界");
});

test("segmentsFromPdfTextContent can map rotated PDF rectangles into viewport coordinates", () => {
  const segments = segmentsFromPdfTextContent({
    pageIndex: 0,
    viewport: {
      convertToViewportRectangle([x0, y0, x1, y1]) {
        return [200 - y1, x0, 200 - y0, x1];
      },
    },
    textContent: {
      items: [{
        str: "Rotated sentence.",
        width: 80,
        height: 12,
        transform: [12, 0, 0, 12, 20, 40],
      }],
    },
  });

  assert.deepEqual(segments[0].bbox, {
    x: 148,
    y: 20,
    width: 12,
    height: 80,
  });
});

test("createTextSegment preserves paragraph and PDF layout hints", () => {
  const segment = createTextSegment({
    text: "A line.",
    paragraphId: 4,
    blockId: "body",
    hasEOL: true,
    fontName: "Times",
    direction: "ltr",
  });
  assert.equal(segment.paragraphId, "4");
  assert.equal(segment.blockId, "body");
  assert.equal(segment.hasEOL, true);
  assert.equal(segment.fontName, "Times");
  assert.equal(segment.direction, "ltr");
});
