import test from "node:test";
import assert from "node:assert/strict";

import {
  bboxFromOcrBox,
  cleanOcrItemText,
  normalizeOcrResult,
  pointSegmentPreferenceForOcrLanguageSet,
  segmentsFromOcrResult,
} from "../ocr-segment-adapter.mjs";

test("cleanOcrItemText removes scanned page borders but keeps internal columns", () => {
  assert.equal(cleanOcrItemText({ text: "| 丁さんは会社員です。 |" }), "丁さんは会社員です。");
  assert.equal(cleanOcrItemText({ text: "休暇 | 休假 | holiday" }), "休暇 | 休假 | holiday");
});

test("bboxFromOcrBox accepts Tesseract x0/y0/x1/y1 boxes", () => {
  assert.deepEqual(bboxFromOcrBox({ bbox: { x0: 10, y0: 20, x1: 70, y1: 44 } }), {
    x: 10,
    y: 20,
    width: 60,
    height: 24,
  });
});

test("bboxFromOcrBox accepts DOM-like left/top/width/height boxes", () => {
  assert.deepEqual(bboxFromOcrBox({ left: 5, top: 8, width: 40, height: 12 }), {
    x: 5,
    y: 8,
    width: 40,
    height: 12,
  });
});

test("normalizeOcrResult supports raw Tesseract data and provider-shaped results", () => {
  const raw = normalizeOcrResult({ data: { text: "hello", lines: [{ text: "hello" }] } });
  assert.equal(raw.text, "hello");
  assert.equal(raw.lines.length, 1);

  const shaped = normalizeOcrResult({ text: "world", words: [{ text: "world" }], pageDimensions: { width: 100, height: 200 } });
  assert.equal(shaped.text, "world");
  assert.equal(shaped.words.length, 1);
  assert.equal(shaped.pageDimensions.width, 100);
});

test("normalizeOcrResult restores Tesseract 7 lines and words from blocks", () => {
  const words = [
    { text: "Patient", confidence: 94, bbox: { x0: 10, y0: 20, x1: 80, y1: 42 } },
    { text: "reading", confidence: 92, bbox: { x0: 86, y0: 20, x1: 150, y1: 42 } },
  ];
  const line = {
    text: "Patient reading",
    confidence: 93,
    bbox: { x0: 10, y0: 20, x1: 150, y1: 42 },
    words,
  };
  const normalized = normalizeOcrResult({
    data: {
      text: "Patient reading",
      blocks: [{ paragraphs: [{ lines: [line] }] }],
    },
  });

  assert.equal(normalized.blocks.length, 1);
  assert.equal(normalized.lines.length, 1);
  assert.equal(normalized.lines[0].text, line.text);
  assert.equal(normalized.lines[0].paragraphId, "block:0:paragraph:0");
  assert.equal(normalized.lines[0].blockId, "block:0");
  assert.deepEqual(normalized.words.map((word) => word.text), words.map((word) => word.text));
  assert.equal(normalized.words[0].paragraphId, "block:0:paragraph:0");
});

test("paragraph lines take precedence when a block also exposes the same lines", () => {
  const line = {
    text: "One line only",
    confidence: 90,
    bbox: { x0: 10, y0: 20, x1: 130, y1: 42 },
    words: [],
  };
  const normalized = normalizeOcrResult({
    data: {
      text: line.text,
      blocks: [{ lines: [line], paragraphs: [{ lines: [line] }] }],
    },
  });

  assert.equal(normalized.lines.length, 1);
  assert.equal(normalized.lines[0].text, line.text);
  assert.equal(normalized.lines[0].paragraphId, "block:0:paragraph:0");
});

test("segmentsFromOcrResult prefers lines and creates OCR TextSegments", () => {
  const segments = segmentsFromOcrResult({
    pageIndex: 3,
    result: {
      text: "Concepts are theories about ontology.",
      lines: [
        { text: "Concepts are theories", confidence: 92, bbox: { x0: 10, y0: 20, x1: 160, y1: 38 } },
        { text: "about ontology.", confidence: 88, bbox: { x0: 10, y0: 42, x1: 130, y1: 60 } },
      ],
      words: [
        { text: "Concepts", confidence: 99, bbox: { x0: 10, y0: 20, x1: 70, y1: 38 } },
      ],
    },
  });

  assert.equal(segments.length, 2);
  assert.equal(segments[0].pageIndex, 3);
  assert.equal(segments[0].source, "ocr");
  assert.equal(segments[0].confidence, 0.92);
  assert.equal(segments[0].hasEOL, true);
  assert.equal(segments[1].bbox.y, 42);
});

test("segmentsFromOcrResult preserves Tesseract paragraph identity", () => {
  const segments = segmentsFromOcrResult({
    result: {
      data: {
        blocks: [{
          paragraphs: [
            { lines: [{ text: "Paragraph one.", bbox: { x0: 1, y0: 2, x1: 90, y1: 18 } }] },
            { lines: [{ text: "Paragraph two.", bbox: { x0: 1, y0: 22, x1: 90, y1: 38 } }] },
          ],
        }],
      },
    },
  });
  assert.equal(segments[0].paragraphId, "block:0:paragraph:0");
  assert.equal(segments[1].paragraphId, "block:0:paragraph:1");
  assert.equal(segments[0].blockId, "block:0");
});

test("word-preferred OCR segments inherit paragraph identity from their line", () => {
  const segments = segmentsFromOcrResult({
    prefer: "words",
    result: {
      data: {
        blocks: [{
          paragraphs: [{
            lines: [{
              text: "Two words",
              bbox: { x0: 1, y0: 2, x1: 80, y1: 18 },
              words: [
                { text: "Two", bbox: { x0: 1, y0: 2, x1: 30, y1: 18 } },
                { text: "words", bbox: { x0: 34, y0: 2, x1: 80, y1: 18 } },
              ],
            }],
          }],
        }],
      },
    },
  });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].paragraphId, "block:0:paragraph:0");
  assert.equal(segments[1].paragraphId, "block:0:paragraph:0");
});

test("segmentsFromOcrResult falls back to words when lines are absent", () => {
  const segments = segmentsFromOcrResult({
    result: {
      text: "民主 democracy",
      words: [
        { text: "民主", confidence: 96, bbox: { x0: 1, y0: 2, x1: 30, y1: 18 } },
        { text: "democracy", confidence: 90, bbox: { x0: 34, y0: 2, x1: 100, y1: 18 } },
      ],
    },
  });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].languageHint, "cjk");
  assert.equal(segments[1].languageHint, "latin");
});

test("CJK point reading uses stable OCR lines while Latin keeps precise words", () => {
  assert.equal(pointSegmentPreferenceForOcrLanguageSet("jpn+chi_sim+eng"), "lines");
  assert.equal(pointSegmentPreferenceForOcrLanguageSet("chi_sim+eng"), "lines");
  assert.equal(pointSegmentPreferenceForOcrLanguageSet("chi_tra+eng"), "lines");
  assert.equal(pointSegmentPreferenceForOcrLanguageSet("eng"), "words");
  assert.equal(pointSegmentPreferenceForOcrLanguageSet(""), "words");
});
