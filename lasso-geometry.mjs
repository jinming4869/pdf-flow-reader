function finitePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  const result = { x, y };
  if (point.pressure !== undefined) {
    const pressure = Number(point.pressure);
    if (Number.isFinite(pressure) && pressure >= 0 && pressure <= 1) result.pressure = pressure;
  }
  if (point.time !== undefined) {
    const time = Number(point.time);
    if (Number.isFinite(time) && time >= 0) result.time = time;
  }
  return result;
}

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function squaredSegmentDistance(point, start, end) {
  let x = start.x;
  let y = start.y;
  let dx = end.x - x;
  let dy = end.y - y;
  if (dx !== 0 || dy !== 0) {
    const ratio = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
    if (ratio > 1) {
      x = end.x;
      y = end.y;
    } else if (ratio > 0) {
      x += dx * ratio;
      y += dy * ratio;
    }
  }
  dx = point.x - x;
  dy = point.y - y;
  return dx * dx + dy * dy;
}

function simplifySection(points, first, last, squaredTolerance, output) {
  let maximum = squaredTolerance;
  let index = -1;
  for (let cursor = first + 1; cursor < last; cursor += 1) {
    const squaredDistance = squaredSegmentDistance(points[cursor], points[first], points[last]);
    if (squaredDistance > maximum) {
      maximum = squaredDistance;
      index = cursor;
    }
  }
  if (index < 0) return;
  if (index - first > 1) simplifySection(points, first, index, squaredTolerance, output);
  output.push(points[index]);
  if (last - index > 1) simplifySection(points, index, last, squaredTolerance, output);
}

function simplifyPath(points, tolerance) {
  if (points.length <= 3 || tolerance <= 0) return points.slice();
  const output = [points[0]];
  simplifySection(points, 0, points.length - 1, tolerance * tolerance, output);
  output.push(points.at(-1));
  return output;
}

function chaikinClosed(points) {
  const result = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    result.push({
      x: current.x * 0.75 + next.x * 0.25,
      y: current.y * 0.75 + next.y * 0.25,
    });
    result.push({
      x: current.x * 0.25 + next.x * 0.75,
      y: current.y * 0.25 + next.y * 0.75,
    });
  }
  return result;
}

function capPath(points, maximum) {
  if (points.length <= maximum) return points;
  const capped = [];
  for (let index = 0; index < maximum; index += 1) {
    capped.push(points[Math.floor(index * points.length / maximum)]);
  }
  return capped;
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function pointInsideRectangle(point, rectangle) {
  return (
    point.x >= rectangle.x &&
    point.x <= rectangle.x + rectangle.width &&
    point.y >= rectangle.y &&
    point.y <= rectangle.y + rectangle.height
  );
}

function orientation(a, b, c) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a, b, c) {
  return (
    b.x >= Math.min(a.x, c.x) && b.x <= Math.max(a.x, c.x) &&
    b.y >= Math.min(a.y, c.y) && b.y <= Math.max(a.y, c.y)
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  const epsilon = 1e-12;
  if (Math.abs(o1) <= epsilon && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= epsilon && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= epsilon && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= epsilon && onSegment(c, b, d)) return true;
  return false;
}

function normalizedBox(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (
    !Number.isFinite(x) || !Number.isFinite(y) ||
    !Number.isFinite(width) || !Number.isFinite(height) ||
    width <= 0 || height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x
    );
    if (crosses) inside = !inside;
  }
  return inside;
}

function boxIntersectsPolygon(box, polygon) {
  if (polygon.some((point) => pointInsideRectangle(point, box))) return true;
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  if (corners.some((point) => pointInPolygon(point, polygon))) return true;
  for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex += 1) {
    const a = polygon[polygonIndex];
    const b = polygon[(polygonIndex + 1) % polygon.length];
    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const c = corners[cornerIndex];
      const d = corners[(cornerIndex + 1) % corners.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function chunkProvenance(chunk) {
  const value = String(chunk?.provenance ?? chunk?.source ?? "").toLowerCase();
  if (value.includes("ocr")) return "ocr";
  if (value.includes("native") || value.includes("pdf")) return "native";
  return "none";
}

export function normalizePointerToPage({ clientX, clientY, rectangle } = {}) {
  const width = Number(rectangle?.width);
  const height = Number(rectangle?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
  const x = (Number(clientX) - Number(rectangle.left)) / width;
  const y = (Number(clientY) - Number(rectangle.top)) / height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return { x, y };
}

export function sampleLassoPoint(points = [], point, {
  minDistance = 0.002,
  maxPoints = 2048,
} = {}) {
  const normalized = finitePoint(point);
  if (!normalized || !Array.isArray(points)) return points;
  const maximum = Math.max(3, Math.trunc(Number(maxPoints) || 0));
  if (points.length >= maximum) return points;
  const previous = points.at(-1);
  if (previous && distance(previous, normalized) < Math.max(0, Number(minDistance) || 0)) {
    return points;
  }
  return [...points, normalized];
}

export function lassoBounds(path = []) {
  const points = path.map(finitePoint).filter(Boolean);
  if (points.length < 3) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

export function prepareLassoPath(rawPath = [], {
  simplifyTolerance = 0.0015,
  smoothingIterations = 1,
  minArea = 0.0005,
  maxPoints = 1024,
} = {}) {
  if (!Array.isArray(rawPath)) {
    return { valid: false, reason: "not-enough-points", path: [], bounds: null, area: 0 };
  }
  const normalized = rawPath.map(finitePoint).filter(Boolean);
  if (normalized.length < 3) {
    return { valid: false, reason: "not-enough-points", path: [], bounds: null, area: 0 };
  }
  let path = simplifyPath(normalized, Math.max(0, Number(simplifyTolerance) || 0));
  if (path.length < 3) {
    return { valid: false, reason: "not-enough-points", path: [], bounds: null, area: 0 };
  }
  const iterations = Math.max(0, Math.min(3, Math.trunc(Number(smoothingIterations) || 0)));
  for (let index = 0; index < iterations; index += 1) path = chaikinClosed(path);
  path = capPath(path, Math.max(3, Math.trunc(Number(maxPoints) || 1024)));
  const area = polygonArea(path);
  const minimumArea = Math.max(0, Number(minArea) || 0);
  const bounds = lassoBounds(path);
  if (!bounds || area < minimumArea) {
    return { valid: false, reason: "area-too-small", path, bounds, area };
  }
  return { valid: true, reason: null, path, bounds, area };
}

export function selectLassoText(chunks = [], path = []) {
  const polygon = path.map(finitePoint).filter(Boolean);
  if (polygon.length < 3) return { chunks: [], text: "", provenance: "none" };
  const selected = [];
  const provenances = new Set();
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const box = normalizedBox(chunk?.normalizedBbox);
    const text = typeof chunk?.text === "string" ? chunk.text.trim() : "";
    if (!box || !text || !boxIntersectsPolygon(box, polygon)) continue;
    selected.push(chunk);
    provenances.add(chunkProvenance(chunk));
  }
  provenances.delete("none");
  const provenance = provenances.size > 1
    ? "mixed"
    : provenances.values().next().value ?? "none";
  return {
    chunks: selected,
    text: selected.map((chunk) => chunk.text.trim()).join("\n"),
    provenance,
  };
}
