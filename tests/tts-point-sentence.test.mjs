import test from "node:test";
import assert from "node:assert/strict";

import { createTextSegment } from "../text-segment.mjs";
import { splitSentenceRanges } from "../tts-sentence.mjs";
import {
  createPointSentenceTargets,
  pickPointSentence,
} from "../tts-point-sentence.mjs";

const PAGE = { width: 600, height: 800, coordinateSystem: "top-down" };

function segment(text, {
  x = 50,
  y = 100,
  width = 240,
  height = 16,
  index = 0,
  pageIndex = 0,
  source = "native-text",
  paragraphId = null,
} = {}) {
  return createTextSegment({
    documentId: "book",
    pageIndex,
    segmentIndex: index,
    text,
    bbox: { x, y, width, height },
    source,
    paragraphId,
  });
}

test("splitSentenceRanges preserves raw offsets and marks only real sentence endings complete", () => {
  const source = "  Dr. Smith arrived.   下一句。 unfinished";
  const ranges = splitSentenceRanges(source);

  assert.deepEqual(ranges.map(({ text, complete }) => ({ text, complete })), [
    { text: "Dr. Smith arrived.", complete: true },
    { text: "下一句。", complete: true },
    { text: "unfinished", complete: false },
  ]);
  for (const range of ranges) {
    assert.equal(source.slice(range.start, range.end).trim(), range.text);
  }
});

test("createPointSentenceTargets maps Chinese, English and Japanese sentences across lines", () => {
  const cases = [
    {
      lines: ["让阅读像亲吻", "纸质书一样好玩。未完"],
      expected: "让阅读像亲吻纸质书一样好玩。",
    },
    {
      lines: ["The reader keeps", "moving forward. Unfinished"],
      expected: "The reader keeps moving forward.",
    },
    {
      lines: ["夜の書斎で、", "静かに読みます。未完"],
      expected: "夜の書斎で、静かに読みます。",
    },
  ];

  for (const [caseIndex, fixture] of cases.entries()) {
    const targets = createPointSentenceTargets(fixture.lines.map((text, lineIndex) => (
      segment(text, {
        y: 100 + lineIndex * 24,
        index: caseIndex * 10 + lineIndex,
      })
    )), { pageDimensions: PAGE, coordinateSystem: "top-down" });

    assert.equal(targets.length, 1);
    assert.equal(targets[0].text, fixture.expected);
    assert.equal(targets[0].complete, true);
    assert.equal(targets[0].fragments.length, 2);
    assert.deepEqual(
      targets[0].fragments.map((fragment) => fragment.text),
      fixture.lines.map((line, index) => (
        index === fixture.lines.length - 1 ? line.replace(/未完$| Unfinished$/, "") : line
      )),
    );
    assert.equal(targets[0].role, "body");
  }
});

test("createPointSentenceTargets reads a two-column page down the left column before the right", () => {
  const segments = [];
  for (let row = 0; row < 4; row += 1) {
    segments.push(segment(`Left ${row + 1}.`, {
      x: 40,
      y: 100 + row * 28,
      width: 210,
      index: row * 2,
    }));
    segments.push(segment(`Right ${row + 1}.`, {
      x: 350,
      y: 100 + row * 28,
      width: 210,
      index: row * 2 + 1,
    }));
  }

  const targets = createPointSentenceTargets(segments, {
    pageDimensions: PAGE,
    coordinateSystem: "top-down",
  });

  assert.deepEqual(targets.map((target) => target.text), [
    "Left 1.", "Left 2.", "Left 3.", "Left 4.",
    "Right 1.", "Right 2.", "Right 3.", "Right 4.",
  ]);
  assert.deepEqual(targets.map((target) => target.columnIndex), [0, 0, 0, 0, 1, 1, 1, 1]);
});

test("point sentences never join journal columns separated by a narrow gutter", () => {
  const segments = [];
  for (let row = 0; row < 4; row += 1) {
    segments.push(segment(`Left narrow ${row + 1}.`, {
      x: 40,
      y: 100 + row * 28,
      width: 250,
      index: row * 2,
    }));
    segments.push(segment(`Right narrow ${row + 1}.`, {
      x: 310,
      y: 100 + row * 28,
      width: 250,
      index: row * 2 + 1,
    }));
  }

  const targets = createPointSentenceTargets(segments, {
    pageDimensions: PAGE,
    coordinateSystem: "top-down",
  });

  assert.deepEqual(targets.map((target) => target.text), [
    "Left narrow 1.", "Left narrow 2.", "Left narrow 3.", "Left narrow 4.",
    "Right narrow 1.", "Right narrow 2.", "Right narrow 3.", "Right narrow 4.",
  ]);
});

test("point sentence text does not insert spaces between adjacent CJK text items", () => {
  const targets = createPointSentenceTargets([
    segment("让阅读", { x: 50, y: 100, width: 60, index: 0 }),
    segment("更", { x: 112, y: 100, width: 20, index: 1 }),
    segment("好玩。", { x: 134, y: 100, width: 60, index: 2 }),
  ], { pageDimensions: PAGE });

  assert.equal(targets[0].text, "让阅读更好玩。");
  assert.equal(targets[0].fragments[0].text, "让阅读更好玩。");
});

test("createPointSentenceTargets normalizes native PDF and OCR top-down coordinates equally", () => {
  const native = createPointSentenceTargets([
    segment("Native sentence.", {
      y: 680,
      height: 20,
      source: "native-text",
    }),
  ], {
    pageDimensions: { ...PAGE, coordinateSystem: "pdf" },
    coordinateSystem: "pdf",
  });
  const ocr = createPointSentenceTargets([
    segment("OCR sentence.", {
      y: 100,
      height: 20,
      source: "ocr",
    }),
  ], {
    pageDimensions: PAGE,
    coordinateSystem: "top-down",
  });

  assert.equal(native[0].fragments[0].normalizedBbox.y, 0.125);
  assert.equal(ocr[0].fragments[0].normalizedBbox.y, 0.125);
  assert.equal(native[0].source, "native-text");
  assert.equal(ocr[0].source, "ocr");
});

test("point sentence targets have stable keys and preserve role and quality metadata", () => {
  const segments = [segment(
    "1 Replication data: https://doi.org/10.1000/example.",
    { y: 730, width: 480 },
  )];
  const options = { pageDimensions: PAGE, coordinateSystem: "top-down" };
  const first = createPointSentenceTargets(segments, options)[0];
  const second = createPointSentenceTargets(segments, options)[0];

  assert.equal(first.key, second.key);
  assert.equal(first.role, "footnote");
  assert.ok(first.qualityFlags.includes("bibliographic"));
  assert.ok(first.normalizedBbox);
  assert.ok(first.fragments[0].normalizedBbox);
});

test("pickPointSentence prefers an exact fragment, then a nearby target within a small radius", () => {
  const targets = createPointSentenceTargets([
    segment("First sentence.", { x: 60, y: 100, width: 180, index: 0 }),
    segment("Second sentence.", { x: 60, y: 150, width: 180, index: 1 }),
  ], { pageDimensions: PAGE });

  assert.equal(pickPointSentence(targets, { x: 0.2, y: 0.135 })?.text, "First sentence.");
  assert.equal(
    pickPointSentence(targets, { x: 0.2, y: 0.19, maxDistance: 0.04 })?.text,
    "Second sentence.",
  );
  assert.equal(pickPointSentence(targets, { x: 0.9, y: 0.9, maxDistance: 0.03 }), null);
});

test("pickPointSentence does not jump across the gutter to another column", () => {
  const left = {
    key: "left",
    columnIndex: 0,
    fragments: [{ normalizedBbox: { x: 0.45, y: 0.2, width: 0.04, height: 0.03 } }],
  };
  const right = {
    key: "right",
    columnIndex: 1,
    fragments: [{ normalizedBbox: { x: 0.7, y: 0.2, width: 0.1, height: 0.03 } }],
  };

  assert.equal(
    pickPointSentence([left, right], { x: 0.51, y: 0.215, maxDistance: 0.05 }),
    null,
  );
});
