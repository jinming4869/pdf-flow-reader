import test from "node:test";
import assert from "node:assert/strict";
import {
  captureReadingAnchor,
  createEstimatedPageLayout,
  findPageNumberAtOffset,
  pageTopsFromLayout,
  restoreReadingAnchor,
  updatePageLayout,
} from "../page-layout.mjs";

test("estimated layout uses the first page size for every shell", () => {
  const layout = createEstimatedPageLayout({ pageCount: 4, width: 600, height: 800 });
  assert.deepEqual(layout.map(({ height }) => height), [800, 800, 800, 800]);
  assert.equal(layout[0].measured, true);
  assert.equal(layout[1].measured, false);
});

test("page height correction updates following offsets", () => {
  const initial = createEstimatedPageLayout({ pageCount: 3, width: 600, height: 800 });
  const corrected = updatePageLayout(initial, 2, { width: 600, height: 1_000 });
  assert.deepEqual(pageTopsFromLayout(corrected, { start: 94, gap: 24 }), [94, 918, 1_942]);
  assert.equal(initial[1].height, 800, "the pure update must not mutate the old layout");
});

test("binary page lookup handles boundaries and large indexes", () => {
  const tops = Array.from({ length: 1_000 }, (_, index) => 94 + index * 824);
  assert.equal(findPageNumberAtOffset(tops, 0), 1);
  assert.equal(findPageNumberAtOffset(tops, 94), 1);
  assert.equal(findPageNumberAtOffset(tops, 918), 2);
  assert.equal(findPageNumberAtOffset(tops, tops[999] + 500), 1_000);
});

test("reading anchor stays at the same relative point after correction", () => {
  const anchor = captureReadingAnchor({
    pageNumber: 4,
    pageTop: 2_500,
    pageHeight: 1_000,
    scrollTop: 2_500,
    viewportHeight: 800,
  });
  assert.equal(anchor.relativeOffset, 0.304);
  assert.equal(
    restoreReadingAnchor(anchor, {
      pageTop: 2_700,
      pageHeight: 1_200,
      viewportHeight: 800,
    }),
    2_760.8,
  );
});
