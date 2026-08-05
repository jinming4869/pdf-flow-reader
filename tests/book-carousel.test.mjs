import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOOK_COVER_PALETTES,
  bookSequenceLabel,
  carouselOffset,
  moveCarouselIndex,
  normalizeCarouselIndex,
  paletteForBook,
} from "../book-carousel.mjs";

test("carousel indexes wrap in both directions", () => {
  assert.equal(normalizeCarouselIndex(7, 5), 2);
  assert.equal(normalizeCarouselIndex(-1, 5), 4);
  assert.equal(moveCarouselIndex(0, 5, -1), 4);
  assert.equal(moveCarouselIndex(4, 5, 1), 0);
  assert.equal(normalizeCarouselIndex(4, 0), 0);
});

test("carousel offsets choose the shortest circular path", () => {
  assert.deepEqual(carouselOffset(0, 0, 7), { offset: 0, hidden: false });
  assert.deepEqual(carouselOffset(6, 0, 7), { offset: -1, hidden: false });
  assert.deepEqual(carouselOffset(4, 0, 7), { offset: -3, hidden: false });
  assert.deepEqual(carouselOffset(4, 0, 10), { offset: 4, hidden: true });
});

test("book palettes are deterministic and shared", () => {
  const first = paletteForBook("doc_alpha");
  const second = paletteForBook("doc_alpha");
  assert.equal(first, second);
  assert.ok(BOOK_COVER_PALETTES.includes(first));
  assert.match(first.base, /^#[0-9a-f]{6}$/i);
});

test("book sequence labels are stable and padded", () => {
  assert.equal(bookSequenceLabel(0, 7), "01 / 07");
  assert.equal(bookSequenceLabel(8, 7), "02 / 07");
});

test("desktop package and opening markup include the carousel surface", () => {
  const packageJson = JSON.parse(readFileSync(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  assert.ok(packageJson.build.files.includes("book-carousel.mjs"));

  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["recentBooks", "bookPrev", "bookNext", "takeBook", "openNewBook"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});
