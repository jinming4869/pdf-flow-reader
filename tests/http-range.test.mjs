import assert from "node:assert/strict";
import test from "node:test";

import { parseByteRange } from "../http-range.mjs";

test("parses closed, open-ended, and suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), {
    ok: true,
    start: 10,
    end: 19,
    length: 10,
  });
  assert.deepEqual(parseByteRange("bytes=90-", 100), {
    ok: true,
    start: 90,
    end: 99,
    length: 10,
  });
  assert.deepEqual(parseByteRange("bytes=-12", 100), {
    ok: true,
    start: 88,
    end: 99,
    length: 12,
  });
  assert.deepEqual(parseByteRange("bytes=-500", 100), {
    ok: true,
    start: 0,
    end: 99,
    length: 100,
  });
  assert.deepEqual(parseByteRange("bytes=95-999", 100), {
    ok: true,
    start: 95,
    end: 99,
    length: 5,
  });
});

test("distinguishes no range from invalid or unsatisfiable ranges", () => {
  assert.equal(parseByteRange(undefined, 100), null);
  assert.deepEqual(parseByteRange("bytes=", 100), { ok: false });
  assert.deepEqual(parseByteRange("bytes=-0", 100), { ok: false });
  assert.deepEqual(parseByteRange("bytes=100-", 100), { ok: false });
  assert.deepEqual(parseByteRange("bytes=20-10", 100), { ok: false });
  assert.deepEqual(parseByteRange("bytes=0-1,4-5", 100), { ok: false });
  assert.deepEqual(parseByteRange("items=0-1", 100), { ok: false });
  assert.deepEqual(parseByteRange("bytes=0-1", 0), { ok: false });
  assert.deepEqual(parseByteRange("bytes=9007199254740992-", 100), { ok: false });
});
