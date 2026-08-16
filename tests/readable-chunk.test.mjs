import test from "node:test";
import assert from "node:assert/strict";

import { createTextSegment } from "../text-segment.mjs";
import {
  createReadableChunk,
  linesToReadableChunks,
  orderLinesForReading,
  priorityForRole,
  segmentsToLines,
  segmentsToReadableChunks,
} from "../readable-chunk.mjs";
import { repeatedLineKeys } from "../text-cleaner.mjs";

function segment(text, { x = 50, y = 100, width = 400, height = 12, pageIndex = 0, index = 0 } = {}) {
  return createTextSegment({
    pageIndex,
    segmentIndex: index,
    text,
    bbox: { x, y, width, height },
  });
}

test("createReadableChunk stores y range and language hint", () => {
  const chunk = createReadableChunk({
    pageIndex: 1,
    chunkIndex: 2,
    text: "  Concepts are theories about ontology.  ",
    bbox: { x: 10, y: 20, width: 100, height: 30 },
  });
  assert.equal(chunk.text, "Concepts are theories about ontology.");
  assert.equal(chunk.languageHint, "latin");
  assert.equal(chunk.yStart, 20);
  assert.equal(chunk.yEnd, 50);
});

test("segmentsToLines groups nearby text items into reading lines", () => {
  const lines = segmentsToLines([
    segment("Collier", { x: 50, y: 100, width: 42, index: 0 }),
    segment("and", { x: 98, y: 101, width: 24, index: 1 }),
    segment("Bollen", { x: 130, y: 100, width: 48, index: 2 }),
    segment("Next line", { x: 50, y: 125, width: 70, index: 3 }),
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "Collier and Bollen");
  assert.deepEqual(lines[0].sourceSegmentIds, [0, 1, 2]);
});

test("segmentsToLines does not merge same-height text across two columns", () => {
  const lines = segmentsToLines([
    segment("Left column", { x: 40, y: 100, width: 180, index: 0 }),
    segment("Right column", { x: 340, y: 100, width: 180, index: 1 }),
  ], { pageWidth: 600 });
  assert.deepEqual(lines.map((line) => line.text), ["Left column", "Right column"]);
});

test("segmentsToLines preserves a narrow center gutter in journal layouts", () => {
  const lines = segmentsToLines([
    segment("Left journal column", { x: 40, y: 100, width: 250, index: 0 }),
    segment("Right journal column", { x: 310, y: 100, width: 250, index: 1 }),
  ], { pageWidth: 600 });
  assert.deepEqual(lines.map((line) => line.text), [
    "Left journal column",
    "Right journal column",
  ]);
});

test("linesToReadableChunks filters running headers and repairs hyphenation", () => {
  const repeated = repeatedLineKeys([
    ["CHAPTER ONE", "The contrast between Collier and Bollen on democ- racy illustrates this law in action."],
    ["CHAPTER ONE", "Bollen has made major contributions to the literature."],
  ]);
  const chunks = linesToReadableChunks([
    { text: "October 20, 2005 14:31 nec100 Sheet number 17 Page number 3", bbox: { x: 0, y: 0, width: 500, height: 10 }, sourceSegmentIds: [] },
    { text: "CHAPTER ONE", bbox: { x: 50, y: 20, width: 120, height: 10 }, sourceSegmentIds: [] },
    { text: "The contrast between Collier and Bollen on democ- racy illustrates this law in action.", bbox: { x: 50, y: 100, width: 420, height: 12 }, sourceSegmentIds: [1] },
    { text: "Bollen has made major contributions to the literature.", bbox: { x: 50, y: 118, width: 420, height: 12 }, sourceSegmentIds: [2] },
    { text: "3", bbox: { x: 300, y: 750, width: 10, height: 10 }, sourceSegmentIds: [] },
  ], { repeatedLines: repeated, minChars: 140, maxChars: 280 });
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /democracy illustrates/);
  assert.doesNotMatch(chunks[0].text, /CHAPTER ONE|Sheet number/);
});

test("orderLinesForReading reads the left column before the right column", () => {
  const lines = [
    { text: "R1", bbox: { x: 340, y: 100, width: 220, height: 12 } },
    { text: "L1", bbox: { x: 50, y: 100, width: 220, height: 12 } },
    { text: "R2", bbox: { x: 340, y: 120, width: 220, height: 12 } },
    { text: "L2", bbox: { x: 50, y: 120, width: 220, height: 12 } },
    { text: "R3", bbox: { x: 340, y: 140, width: 220, height: 12 } },
    { text: "L3", bbox: { x: 50, y: 140, width: 220, height: 12 } },
    { text: "R4", bbox: { x: 340, y: 160, width: 220, height: 12 } },
    { text: "L4", bbox: { x: 50, y: 160, width: 220, height: 12 } },
  ];
  assert.deepEqual(orderLinesForReading(lines, { pageWidth: 600 }).map((line) => line.text), [
    "L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4",
  ]);
});

function twoColumnPage({ pageWidth = 612, leftX = 54, leftWidth = 252, rightX = 330, rightWidth = 252, rows = 8, order = "colwise", top = 100, rowGap = 14, baselineOffset = 0 } = {}) {
  const segments = [];
  let index = 0;
  const pushRow = (row) => {
    segments.push(segment(`L${row} text`, { x: leftX, y: top + row * rowGap, width: leftWidth, index: index++ }));
    segments.push(segment(`R${row} text`, { x: rightX, y: top + row * rowGap + baselineOffset, width: rightWidth, index: index++ }));
  };
  if (order === "colwise") {
    for (let row = 0; row < rows; row += 1) {
      segments.push(segment(`L${row} text`, { x: leftX, y: top + row * rowGap, width: leftWidth, index: index++ }));
    }
    for (let row = 0; row < rows; row += 1) {
      segments.push(segment(`R${row} text`, { x: rightX, y: top + row * rowGap + baselineOffset, width: rightWidth, index: index++ }));
    }
  } else {
    for (let row = 0; row < rows; row += 1) pushRow(row);
  }
  return { segments, pageWidth };
}

function expectedColumnOrder(rows, prefix = "text") {
  return [
    ...Array.from({ length: rows }, (_, row) => `L${row} ${prefix}`),
    ...Array.from({ length: rows }, (_, row) => `R${row} ${prefix}`),
  ];
}

test("segmentsToReadableChunks reads IEEE two-column pages left column first", () => {
  const { segments, pageWidth } = twoColumnPage({ order: "colwise" });
  const chunks = segmentsToReadableChunks(segments, {
    pageWidth,
    coordinateSystem: "top-down",
    minChars: 1000,
    maxChars: 2000,
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, expectedColumnOrder(8).join(" "));
});

test("segmentsToReadableChunks reads interleaved two-column text left column first", () => {
  const { segments, pageWidth } = twoColumnPage({ order: "interleaved" });
  const chunks = segmentsToReadableChunks(segments, {
    pageWidth,
    coordinateSystem: "top-down",
    minChars: 1000,
    maxChars: 2000,
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, expectedColumnOrder(8).join(" "));
});

test("segmentsToLines splits columns with a narrow 14pt gutter", () => {
  const { segments, pageWidth } = twoColumnPage({ rightX: 320 });
  const lines = segmentsToLines(segments, { pageWidth, coordinateSystem: "top-down" });
  const ordered = orderLinesForReading(lines, { pageWidth, coordinateSystem: "top-down" });
  assert.deepEqual(ordered.map((line) => line.text), expectedColumnOrder(8));
});

test("segmentsToLines splits columns when baselines drift beyond line tolerance", () => {
  const { segments, pageWidth } = twoColumnPage({ baselineOffset: 8 });
  const lines = segmentsToLines(segments, { pageWidth, coordinateSystem: "top-down" });
  const ordered = orderLinesForReading(lines, { pageWidth, coordinateSystem: "top-down" });
  assert.deepEqual(ordered.map((line) => line.text), expectedColumnOrder(8));
});

test("a short last line in the left column does not swallow the right column", () => {
  const { segments, pageWidth } = twoColumnPage({ rows: 7 });
  let index = segments.length;
  segments.push(segment("L7 short", { x: 54, y: 100 + 7 * 14, width: 60, index: index++ }));
  segments.push(segment("R7 text", { x: 330, y: 100 + 7 * 14, width: 252, index: index++ }));
  const lines = segmentsToLines(segments, { pageWidth, coordinateSystem: "top-down" });
  const ordered = orderLinesForReading(lines, { pageWidth, coordinateSystem: "top-down" });
  assert.deepEqual(ordered.map((line) => line.text), [
    ...Array.from({ length: 7 }, (_, row) => `L${row} text`),
    "L7 short",
    ...Array.from({ length: 7 }, (_, row) => `R${row} text`),
    "R7 text",
  ]);
});

test("a centered heading spanning both columns reads before the left column", () => {
  const { segments, pageWidth } = twoColumnPage();
  segments.unshift(segment("SECTION TITLE", { x: 250, y: 60, width: 112, index: -1 }));
  const lines = segmentsToLines(segments, { pageWidth, coordinateSystem: "top-down" });
  const ordered = orderLinesForReading(lines, { pageWidth, coordinateSystem: "top-down" });
  assert.deepEqual(ordered.map((line) => line.text), [
    "SECTION TITLE",
    ...expectedColumnOrder(8),
  ]);
});

test("single-column rows split near the center with 12pt gaps are not treated as columns", () => {
  const segments = [];
  let index = 0;
  for (let row = 0; row < 8; row += 1) {
    segments.push(segment(`line ${row} part A`, { x: 54, y: 100 + row * 14, width: 240, index: index++ }));
    segments.push(segment("part B wide", { x: 306, y: 100 + row * 14, width: 200, index: index++ }));
  }
  const lines = segmentsToLines(segments, { pageWidth: 612, coordinateSystem: "top-down" });
  const ordered = orderLinesForReading(lines, { pageWidth: 612, coordinateSystem: "top-down" });
  assert.deepEqual(ordered.map((line) => line.text), [
    "line 0 part A part B wide",
    "line 1 part A part B wide",
    "line 2 part A part B wide",
    "line 3 part A part B wide",
    "line 4 part A part B wide",
    "line 5 part A part B wide",
    "line 6 part A part B wide",
    "line 7 part A part B wide",
  ]);
});

test("segmentsToReadableChunks creates TTS-sized chunks from page segments", () => {
  const chunks = segmentsToReadableChunks([
    segment("The contrast between Collier and Bollen on democracy illustrates this law in action.", { y: 100, index: 1 }),
    segment("Collier and Mahon provide an insightful analysis of the concept of democracy.", { y: 118, index: 2 }),
    segment("Bollen has made major contributions to the literature on quantitative measures.", { y: 136, index: 3 }),
  ], { minChars: 120, maxChars: 260 });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].role, "body");
  assert.match(chunks[0].text, /Collier and Mahon/);
  assert.equal(chunks[0].pageIndex, 0);
});

test("createReadableChunk normalizes PDF coordinate chunks for future reading-line picking", () => {
  const chunk = createReadableChunk({
    text: "Concepts are theories about ontology.",
    bbox: { x: 40, y: 700, width: 220, height: 20 },
    pageDimensions: { width: 600, height: 800, coordinateSystem: "pdf" },
  });
  assert.equal(chunk.yStart, 80);
  assert.equal(chunk.yEnd, 100);
  assert.equal(chunk.normalizedBbox.y, 0.1);
});

test("createReadableChunk marks dataverse and URL notes as bibliographic footnotes", () => {
  const chunk = createReadableChunk({
    text: "*Data replication sets are available in Harvard Dataverse at: https://doi.org/10.7910/DVN/example",
    bbox: { x: 40, y: 730, width: 520, height: 24 },
    pageDimensions: { width: 600, height: 800, coordinateSystem: "top-down" },
  });
  assert.equal(chunk.role, "footnote");
  assert.ok(chunk.qualityFlags.includes("bibliographic"));
});

test("createReadableChunk lowers priority for footnotes and formula-like chunks", () => {
  const footnote = createReadableChunk({
    text: "1 This note clarifies the concept example.",
    bbox: { x: 50, y: 720, width: 300, height: 20 },
    pageDimensions: { width: 600, height: 800, coordinateSystem: "top-down" },
  });
  assert.equal(footnote.role, "footnote");
  assert.ok(footnote.priority < 0.5);
  assert.ok(footnote.qualityFlags.includes("role:footnote"));

  const formula = createReadableChunk({
    text: "JG = A + B / C >= 0.75",
    bbox: { x: 50, y: 200, width: 300, height: 20 },
  });
  assert.equal(formula.role, "formula");
  assert.equal(formula.priority, priorityForRole("formula"));
  assert.ok(formula.qualityFlags.includes("symbol-heavy"));
});
