/**
 * Parse a single HTTP byte range.
 *
 * The returned end offset is inclusive, matching createReadStream and the
 * Content-Range header. A missing header means a normal full response; an
 * invalid or unsatisfiable header is represented explicitly so callers can
 * answer with 416 without guessing why parsing failed.
 */
export function parseByteRange(rangeHeader, size) {
  if (rangeHeader == null) return null;

  if (!Number.isSafeInteger(size) || size < 0 || typeof rangeHeader !== "string") {
    return { ok: false };
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || size === 0 || (!match[1] && !match[2])) {
    return { ok: false };
  }

  const first = match[1] ? Number(match[1]) : null;
  const second = match[2] ? Number(match[2]) : null;
  if (
    (first != null && !Number.isSafeInteger(first)) ||
    (second != null && !Number.isSafeInteger(second))
  ) {
    return { ok: false };
  }

  let start;
  let end;
  if (first == null) {
    if (second === 0) return { ok: false };
    const suffixLength = Math.min(second, size);
    start = size - suffixLength;
    end = size - 1;
  } else {
    start = first;
    end = second == null ? size - 1 : Math.min(second, size - 1);
  }

  if (start >= size || start > end) return { ok: false };
  return { ok: true, start, end, length: end - start + 1 };
}
