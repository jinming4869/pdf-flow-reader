import test from "node:test";
import assert from "node:assert/strict";

import { createTextSegment } from "../text-segment.mjs";
import {
  advanceParagraphFlowContext,
  advanceParagraphFlow,
  createParagraphFlowContextKey,
  createParagraphFlowState,
  isLargeParagraphReadingJump,
  materializeParagraphBoundaries,
  segmentsToParagraphPassages,
  shouldPreserveParagraphFlowOnPageChange,
} from "../tts-paragraph-flow.mjs";

function segment(text, {
  pageIndex = 0,
  index = 0,
  x = 50,
  y = 20,
  width = 500,
  height = 12,
  source = "native-text",
  paragraphId = null,
} = {}) {
  return createTextSegment({
    pageIndex,
    segmentIndex: index,
    text,
    bbox: { x, y, width, height },
    source,
    paragraphId,
    hasEOL: true,
  });
}

const pageDimensions = { width: 600, height: 800, coordinateSystem: "top-down" };

test("explicit OCR paragraph ids keep lines together and short paragraphs separate", () => {
  const passages = segmentsToParagraphPassages([
    segment("First paragraph begins here", {
      source: "ocr",
      paragraphId: "p0",
      y: 20,
      index: 0,
    }),
    segment("and ends on its second line.", {
      source: "ocr",
      paragraphId: "p0",
      y: 38,
      width: 260,
      index: 1,
    }),
    segment("A short second paragraph.", {
      source: "ocr",
      paragraphId: "p1",
      y: 56,
      width: 230,
      index: 2,
    }),
  ], { pageDimensions, coordinateSystem: "top-down" });

  assert.equal(passages.length, 2);
  assert.match(passages[0].text, /second line/);
  assert.equal(passages[1].text, "A short second paragraph.");
  assert.equal(passages[1].boundarySource, "ocr-paragraph");
  assert.equal(passages[1].boundaryConfidence, 1);
});

test("native paragraph inference uses a short terminal line without splitting long prose", () => {
  const passages = segmentsToParagraphPassages([
    segment("A long natural paragraph begins and keeps flowing across the page", {
      y: 20,
      width: 500,
      index: 0,
    }),
    segment("until its final short line.", {
      y: 38,
      width: 180,
      index: 1,
    }),
    segment("The next paragraph begins at the ordinary margin", {
      y: 56,
      width: 500,
      index: 2,
    }),
    segment("and remains part of that same paragraph even when it grows very long", {
      y: 74,
      width: 500,
      index: 3,
    }),
    segment("without creating a second lead sentence.", {
      y: 92,
      width: 500,
      index: 4,
    }),
  ], { pageDimensions, coordinateSystem: "top-down" });

  assert.equal(passages.length, 2);
  assert.equal(passages[0].leadSentence.text, passages[0].text);
  assert.match(passages[1].text, /same paragraph/);
  assert.equal(passages[1].boundarySource, "short-terminal-line");
});

test("cross-page continuation keeps one paragraph and only one lead sentence", () => {
  const passages = segmentsToParagraphPassages([
    segment("This paragraph continues onto the next page without a terminal mark", {
      pageIndex: 0,
      y: 760,
      width: 500,
      index: 0,
    }),
    segment("and resumes at the same margin before ending.", {
      pageIndex: 1,
      y: 30,
      width: 420,
      index: 0,
    }),
  ], {
    pageDimensionsByPage: new Map([
      [0, pageDimensions],
      [1, pageDimensions],
    ]),
    coordinateSystem: "top-down",
  });

  assert.equal(passages.length, 1);
  assert.equal(passages[0].crossPage, true);
  assert.equal(passages[0].fragments.length, 2);
  assert.equal(passages[0].fragments[0].continuesOnNext, true);
  assert.equal(passages[0].fragments[1].continuesFromPrevious, true);
  assert.match(passages[0].leadSentence.text, /^This paragraph/);
  assert.match(passages[0].leadSentence.text, /ending\.$/);
});

test("a terminal sentence at a page edge starts a new paragraph on the next page", () => {
  const passages = segmentsToParagraphPassages([
    segment("This paragraph ends on the page.", {
      pageIndex: 0,
      y: 760,
      width: 260,
    }),
    segment("A new paragraph begins here.", {
      pageIndex: 1,
      y: 30,
      width: 250,
    }),
  ], {
    pageDimensionsByPage: new Map([
      [0, pageDimensions],
      [1, pageDimensions],
    ]),
    coordinateSystem: "top-down",
  });

  assert.equal(passages.length, 2);
  assert.equal(passages[0].crossPage, false);
});

test("cross-page linking rejects fragments that are not near page edges", () => {
  const passages = segmentsToParagraphPassages([
    segment("An incomplete caption without terminal punctuation", {
      pageIndex: 0,
      y: 300,
      width: 300,
    }),
    segment("ordinary body text begins in the middle of the next page.", {
      pageIndex: 1,
      y: 300,
      width: 360,
    }),
  ], {
    pageDimensionsByPage: new Map([
      [0, pageDimensions],
      [1, pageDimensions],
    ]),
    coordinateSystem: "top-down",
  });

  assert.equal(passages.length, 2);
  assert.equal(passages[0].crossPage, false);
});

test("materialized boundaries derive fresh absolute positions from page metrics", () => {
  const [passage] = segmentsToParagraphPassages([
    segment("A paragraph.", { y: 80, height: 40, width: 250 }),
  ], { pageDimensions, coordinateSystem: "top-down" });
  const [first] = materializeParagraphBoundaries([passage], new Map([
    [0, { pageTop: 1000, pageHeight: 400 }],
  ]));
  const [resized] = materializeParagraphBoundaries([passage], new Map([
    [0, { pageTop: 1000, pageHeight: 800 }],
  ]));

  assert.equal(first.start, 1040);
  assert.equal(first.end, 1060);
  assert.equal(resized.start, 1080);
  assert.equal(resized.end, 1120);
});

test("two-column reading order creates a boundary only when the column changes", () => {
  const segments = [];
  for (let index = 0; index < 4; index += 1) {
    segments.push(segment(`Left line ${index} continues`, {
      x: 40,
      y: 40 + index * 18,
      width: 230,
      index,
    }));
    segments.push(segment(`Right line ${index} continues`, {
      x: 330,
      y: 40 + index * 18,
      width: 230,
      index: index + 10,
    }));
  }
  const passages = segmentsToParagraphPassages(segments, {
    pageDimensions,
    coordinateSystem: "top-down",
  });

  assert.equal(passages.length, 2);
  assert.match(passages[0].text, /^Left line 0/);
  assert.match(passages[1].text, /^Right line 0/);
  assert.equal(passages[1].boundarySource, "column-change");
});

function passage(index, start, end) {
  const paragraphKey = `paragraph:${index}`;
  return {
    paragraphKey,
    start,
    end,
    leadSentence: {
      key: `${paragraphKey}:lead`,
      text: `Lead ${index}.`,
    },
  };
}

const flowPassages = [
  passage(0, 100, 200),
  passage(1, 220, 320),
  passage(2, 340, 440),
];

test("paragraph flow prepares at a start crossing and plays only a ready lead at the tail", () => {
  let state = createParagraphFlowState({ contextKey: "doc:1", position: 90 });
  let advanced = advanceParagraphFlow(state, {
    contextKey: "doc:1",
    position: 110,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.deepEqual(advanced.actions.map((action) => action.type), ["prepare"]);
  assert.equal(advanced.actions[0].key, "paragraph:1:lead");

  state = advanced.state;
  advanced = advanceParagraphFlow(state, {
    contextKey: "doc:1",
    position: 210,
    isPlaying: true,
    passages: flowPassages,
    readyPreparedKey: "paragraph:1:lead",
  });
  assert.deepEqual(advanced.actions.map((action) => action.type), ["play-prepared"]);
  assert.deepEqual(advanced.state.handledParagraphKeys, ["paragraph:1"]);
});

test("crossing start and tail in one tick skips a late lead without waiting", () => {
  const state = createParagraphFlowState({ contextKey: "doc:1", position: 90 });
  const advanced = advanceParagraphFlow(state, {
    contextKey: "doc:1",
    position: 210,
    isPlaying: true,
    passages: flowPassages,
  });

  assert.deepEqual(
    advanced.actions.map((action) => [action.type, action.reason ?? null]),
    [
      ["prepare", null],
      ["discard-prepared", "late-or-missing"],
    ],
  );
  assert.deepEqual(advanced.state.handledParagraphKeys, ["paragraph:1"]);
});

test("a shared tail and start coordinate plays the ready lead before preparing the next one", () => {
  const adjacent = [
    passage(0, 100, 200),
    passage(1, 200, 300),
    passage(2, 320, 420),
  ];
  const state = {
    ...createParagraphFlowState({ contextKey: "doc:1", position: 150 }),
    preparedKey: "paragraph:1:lead",
  };
  const advanced = advanceParagraphFlow(state, {
    contextKey: "doc:1",
    position: 210,
    isPlaying: true,
    passages: adjacent,
    readyPreparedKey: "paragraph:1:lead",
  });

  assert.deepEqual(
    advanced.actions.map((action) => [action.type, action.key]),
    [
      ["play-prepared", "paragraph:1:lead"],
      ["prepare", "paragraph:2:lead"],
    ],
  );
  assert.equal(advanced.state.preparedKey, "paragraph:2:lead");
  assert.deepEqual(advanced.state.handledParagraphKeys, ["paragraph:1"]);
});

test("bootstrap distinguishes paragraph, gap, beginning, and document end", () => {
  const inside = advanceParagraphFlow(createParagraphFlowState(), {
    contextKey: "doc:1",
    position: 150,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.equal(inside.actions[0].key, "paragraph:1:lead");

  const gap = advanceParagraphFlow(createParagraphFlowState(), {
    contextKey: "doc:1",
    position: 210,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.equal(gap.actions[0].key, "paragraph:1:lead");

  const before = advanceParagraphFlow(createParagraphFlowState(), {
    contextKey: "doc:1",
    position: 50,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.deepEqual(before.actions, []);

  const after = advanceParagraphFlow(createParagraphFlowState(), {
    contextKey: "doc:1",
    position: 999,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.deepEqual(after.actions, []);
});

test("fast forward processes crossings in order while upward movement never replays", () => {
  let state = createParagraphFlowState({ contextKey: "doc:1", position: 90 });
  let advanced = advanceParagraphFlow(state, {
    contextKey: "doc:1",
    position: 430,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.deepEqual(
    advanced.actions.map((action) => action.type),
    ["prepare", "discard-prepared", "prepare", "discard-prepared"],
  );
  assert.deepEqual(advanced.state.handledParagraphKeys, ["paragraph:1", "paragraph:2"]);

  state = advanced.state;
  advanced = advanceParagraphFlow(state, {
    contextKey: "doc:1",
    position: 90,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.deepEqual(advanced.actions, []);

  advanced = advanceParagraphFlow(advanced.state, {
    contextKey: "doc:1",
    position: 430,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.deepEqual(advanced.actions, []);
});

test("pause, jump, and context changes discard prepared work", () => {
  const prepared = {
    ...createParagraphFlowState({ contextKey: "doc:1", position: 150 }),
    preparedKey: "paragraph:1:lead",
  };
  const paused = advanceParagraphFlow(prepared, {
    contextKey: "doc:1",
    position: 150,
    isPlaying: false,
    passages: flowPassages,
  });
  assert.equal(paused.actions[0].reason, "paused");
  assert.equal(paused.state.preparedKey, null);

  const jumped = advanceParagraphFlow(prepared, {
    contextKey: "doc:1",
    position: 800,
    isPlaying: true,
    jumped: true,
    passages: flowPassages,
  });
  assert.equal(jumped.actions[0].reason, "jumped");

  const changed = advanceParagraphFlow(prepared, {
    contextKey: "doc:2",
    position: 150,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.deepEqual(
    changed.actions.map((action) => action.type),
    ["discard-prepared", "prepare"],
  );
  assert.equal(changed.actions[0].reason, "context-changed");
  assert.equal(changed.state.contextKey, "doc:2");
});

test("only a normal adjacent forward page change preserves winding-stream context", () => {
  const base = {
    enabled: true,
    tierKey: "winding-stream",
    previousPage: 4,
    nextPage: 5,
    direction: 1,
    jumped: false,
  };
  assert.equal(shouldPreserveParagraphFlowOnPageChange(base), true);
  assert.equal(shouldPreserveParagraphFlowOnPageChange({ ...base, nextPage: 6 }), false);
  assert.equal(shouldPreserveParagraphFlowOnPageChange({ ...base, nextPage: 3, direction: -1 }), false);
  assert.equal(shouldPreserveParagraphFlowOnPageChange({ ...base, tierKey: "snow-mist" }), false);
  assert.equal(shouldPreserveParagraphFlowOnPageChange({ ...base, jumped: true }), false);
});

test("large reading jump threshold ignores ordinary automatic scrolling", () => {
  assert.equal(isLargeParagraphReadingJump({
    scrollDelta: 12,
    viewportHeight: 900,
  }), false);
  assert.equal(isLargeParagraphReadingJump({
    scrollDelta: 410,
    viewportHeight: 900,
  }), true);
  assert.equal(isLargeParagraphReadingJump({
    scrollDelta: -500,
    viewportHeight: 900,
  }), true);
});

test("paragraph flow context preserves an adjacent sliding window until overlapping content changes", () => {
  let context = advanceParagraphFlowContext(null, {
    documentGeneration: 3,
    controllerGeneration: 7,
    pageNumber: 10,
    windowSources: [
      { pageNumber: 9, source: "native", revision: 1 },
      { pageNumber: 10, source: "native", revision: 2 },
      { pageNumber: 11, source: "ocr", revision: 4 },
    ],
  });
  const baseKey = context.key;
  assert.equal(baseKey, createParagraphFlowContextKey({
    documentGeneration: 3,
    controllerGeneration: 7,
    contentRevision: 0,
  }));

  context = advanceParagraphFlowContext(context.state, {
    documentGeneration: 3,
    controllerGeneration: 7,
    pageNumber: 11,
    windowSources: [
      { pageNumber: 10, source: "native", revision: 2 },
      { pageNumber: 11, source: "ocr", revision: 4 },
      { pageNumber: 12, source: "native", revision: 9 },
    ],
  });
  assert.equal(context.key, baseKey);

  context = advanceParagraphFlowContext(context.state, {
    documentGeneration: 3,
    controllerGeneration: 7,
    pageNumber: 11,
    windowSources: [
      { pageNumber: 10, source: "native", revision: 3 },
      { pageNumber: 11, source: "ocr", revision: 4 },
      { pageNumber: 12, source: "native", revision: 9 },
    ],
  });
  assert.notEqual(context.key, baseKey);

  const changedSource = advanceParagraphFlowContext(context.state, {
    documentGeneration: 3,
    controllerGeneration: 7,
    pageNumber: 11,
    windowSources: [
      { pageNumber: 10, source: "ocr", revision: 2 },
      { pageNumber: 11, source: "ocr", revision: 4 },
      { pageNumber: 12, source: "native", revision: 9 },
    ],
  });
  assert.notEqual(changedSource.key, context.key);
});

test("adjacent context preservation keeps a prepared lead while a real source change discards it", () => {
  const initialContext = advanceParagraphFlowContext(null, {
    documentGeneration: 1,
    controllerGeneration: 2,
    pageNumber: 10,
    windowSources: [
      { pageNumber: 9, source: "native", revision: 1 },
      { pageNumber: 10, source: "native", revision: 1 },
      { pageNumber: 11, source: "native", revision: 1 },
    ],
  });
  const prepared = {
    ...createParagraphFlowState({
      contextKey: initialContext.key,
      position: 150,
    }),
    preparedKey: "paragraph:1:lead",
  };
  const shiftedContext = advanceParagraphFlowContext(initialContext.state, {
    documentGeneration: 1,
    controllerGeneration: 2,
    pageNumber: 11,
    windowSources: [
      { pageNumber: 10, source: "native", revision: 1 },
      { pageNumber: 11, source: "native", revision: 1 },
      { pageNumber: 12, source: "ocr", revision: 5 },
    ],
  });
  const preserved = advanceParagraphFlow(prepared, {
    contextKey: shiftedContext.key,
    position: 160,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.equal(preserved.state.preparedKey, "paragraph:1:lead");
  assert.deepEqual(preserved.actions, []);

  const changedContext = advanceParagraphFlowContext(shiftedContext.state, {
    documentGeneration: 1,
    controllerGeneration: 2,
    pageNumber: 11,
    windowSources: [
      { pageNumber: 10, source: "ocr", revision: 2 },
      { pageNumber: 11, source: "native", revision: 1 },
      { pageNumber: 12, source: "ocr", revision: 5 },
    ],
  });
  const invalidated = advanceParagraphFlow(preserved.state, {
    contextKey: changedContext.key,
    position: 170,
    isPlaying: true,
    passages: flowPassages,
  });
  assert.deepEqual(
    invalidated.actions.map((action) => [action.type, action.reason ?? null]),
    [
      ["discard-prepared", "context-changed"],
      ["prepare", null],
    ],
  );
});
