function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizePageDimensions(pageDimensions = null) {
  if (!pageDimensions || typeof pageDimensions !== "object") return null;
  const width = finiteNumber(pageDimensions.width);
  const height = finiteNumber(pageDimensions.height);
  if (width <= 0 || height <= 0) return null;
  return {
    width,
    height,
    coordinateSystem: pageDimensions.coordinateSystem === "pdf" ? "pdf" : "top-down",
  };
}

export function bboxToTopLeft(bbox = null, pageDimensions = null, coordinateSystem = null) {
  if (!bbox || typeof bbox !== "object") return null;
  const safe = {
    x: finiteNumber(bbox.x),
    y: finiteNumber(bbox.y),
    width: Math.max(0, finiteNumber(bbox.width)),
    height: Math.max(0, finiteNumber(bbox.height)),
  };
  const page = normalizePageDimensions(pageDimensions);
  const system = coordinateSystem ?? page?.coordinateSystem ?? "top-down";
  if (system !== "pdf" || !page) return safe;
  return {
    ...safe,
    y: Math.max(0, page.height - safe.y - safe.height),
  };
}

export function relativeBbox(bbox = null, pageDimensions = null) {
  const page = normalizePageDimensions(pageDimensions);
  if (!bbox || !page) return null;
  return {
    x: clamp(finiteNumber(bbox.x) / page.width, 0, 1),
    y: clamp(finiteNumber(bbox.y) / page.height, 0, 1),
    width: clamp(finiteNumber(bbox.width) / page.width, 0, 1),
    height: clamp(finiteNumber(bbox.height) / page.height, 0, 1),
  };
}

export function enrichChunkCoordinates(chunk = {}, { pageDimensions = null, coordinateSystem = null } = {}) {
  const normalizedPage = normalizePageDimensions(pageDimensions);
  const readingBbox = bboxToTopLeft(chunk.bbox, normalizedPage, coordinateSystem);
  const normalizedBbox = relativeBbox(readingBbox, normalizedPage);
  return {
    ...chunk,
    pageDimensions: normalizedPage,
    readingBbox,
    normalizedBbox,
    yStart: readingBbox ? readingBbox.y : null,
    yEnd: readingBbox ? readingBbox.y + readingBbox.height : null,
  };
}
