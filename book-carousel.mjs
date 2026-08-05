export const BOOK_COVER_PALETTES = Object.freeze([
  Object.freeze({ base: "#d5b06f", deep: "#6e482d", ink: "#241c16", glow: "#f6e7bd" }),
  Object.freeze({ base: "#738d7c", deep: "#314b3e", ink: "#f7f1e4", glow: "#b9d0c1" }),
  Object.freeze({ base: "#a86d62", deep: "#5b3431", ink: "#fff4e7", glow: "#e2aa91" }),
  Object.freeze({ base: "#71839a", deep: "#32445d", ink: "#f6f1e7", glow: "#b9c8d8" }),
  Object.freeze({ base: "#9d8b69", deep: "#51462f", ink: "#fff8e8", glow: "#d9caa5" }),
  Object.freeze({ base: "#777071", deep: "#393536", ink: "#f7f3eb", glow: "#b7adae" }),
  Object.freeze({ base: "#c48a55", deep: "#6b3f28", ink: "#2e2119", glow: "#f1c38c" }),
]);

function hashString(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeCarouselIndex(index, length) {
  const size = Math.max(0, Math.trunc(Number(length) || 0));
  if (!size) return 0;
  const value = Math.trunc(Number(index) || 0);
  return ((value % size) + size) % size;
}

export function moveCarouselIndex(index, length, delta = 0) {
  return normalizeCarouselIndex(
    normalizeCarouselIndex(index, length) + Math.trunc(Number(delta) || 0),
    length,
  );
}

export function carouselOffset(index, selectedIndex, length, maxVisibleOffset = 3) {
  const size = Math.max(0, Math.trunc(Number(length) || 0));
  if (!size) return Object.freeze({ offset: 0, hidden: true });

  const current = normalizeCarouselIndex(index, size);
  const selected = normalizeCarouselIndex(selectedIndex, size);
  let offset = current - selected;
  const half = size / 2;
  if (offset > half) offset -= size;
  if (offset < -half) offset += size;

  const visibleLimit = Math.max(0, Math.trunc(Number(maxVisibleOffset) || 0));
  return Object.freeze({
    offset,
    hidden: Math.abs(offset) > visibleLimit,
  });
}

export function paletteForBook(key = "") {
  const index = hashString(key) % BOOK_COVER_PALETTES.length;
  return BOOK_COVER_PALETTES[index];
}

export function bookSequenceLabel(index, length) {
  const size = Math.max(1, Math.trunc(Number(length) || 1));
  const value = normalizeCarouselIndex(index, size) + 1;
  return `${String(value).padStart(2, "0")} / ${String(size).padStart(2, "0")}`;
}
