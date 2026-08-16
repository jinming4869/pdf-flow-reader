import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveContentHash,
  exportFileStemForTrace,
  renderTraceMarkdown,
  sanitizeDestinationType,
} from "../archive-export.mjs";

function sampleTrace(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "trace_abc123",
    documentId: "doc_1",
    documentFingerprint: "v1:example:1:2",
    pageIndex: 11,
    lassoPath: [{ x: 0.1, y: 0.2, time: 0 }],
    source: { text: "这一段讨论测量效度。", provenance: "native-text" },
    readingContext: {
      speedTier: "long-day",
      speedPxPerSecond: 16,
      readingOrder: 3,
      capturedAt: "2026-08-16T03:58:00.000Z",
    },
    crop: {
      state: "ready",
      reference: "crops/trace_abc123.png",
      mimeType: "image/png",
      width: 320,
      height: 200,
      errorCode: null,
      updatedAt: "2026-08-16T03:58:00.000Z",
    },
    emotion: {
      state: "placed",
      original: { valence: 0.5, arousal: -0.3 },
      current: { valence: -0.5, arousal: -0.5 },
      updatedAt: "2026-08-16T03:58:10.000Z",
    },
    lifecycle: "active",
    trashedAt: null,
    purgeAfter: null,
    purgedAt: null,
    revision: 1,
    createdAt: "2026-08-16T03:58:00.000Z",
    updatedAt: "2026-08-16T03:58:10.000Z",
    ...overrides,
  };
}

test("folder markdown embeds circled text, emotion, and a relative image link", () => {
  const markdown = renderTraceMarkdown({
    trace: sampleTrace(),
    documentName: "测量与效度.pdf",
    echoText: "作者主张概念分歧根源于扩展定义不同。",
    imageName: "20260816-0358-trace_abc123-abcdef.png",
    format: "folder",
  });
  assert.match(markdown, /# 读书痕迹 · 测量与效度\.pdf 第 12 页/);
  assert.match(markdown, /> 这一段讨论测量效度。/);
  assert.match(markdown, /情绪：\(0\.50, -0\.30\) → \(-0\.50, -0\.50\)/);
  assert.match(markdown, /一句复述：作者主张概念分歧根源于扩展定义不同。/);
  assert.match(markdown, /!\[\]\(20260816-0358-trace_abc123-abcdef\.png\)/);
  assert.match(markdown, /痕迹 id：trace_abc123/);
});

test("obsidian markdown uses a wiki-link and omits image line when absent", () => {
  const withImage = renderTraceMarkdown({
    trace: sampleTrace(),
    documentName: "测量与效度.pdf",
    imageName: "x.png",
    format: "obsidian",
  });
  assert.match(withImage, /!\[\[x\.png\]\]/);
  assert.doesNotMatch(withImage, /!\[\]\(/);

  const withoutImage = renderTraceMarkdown({
    trace: sampleTrace(),
    documentName: "测量与效度.pdf",
    format: "obsidian",
  });
  assert.doesNotMatch(withoutImage, /裁图/);
});

test("content hash changes with circled text or echo text", () => {
  const base = sampleTrace();
  const a = archiveContentHash(base, "");
  const b = archiveContentHash(base, "一句复述");
  const c = archiveContentHash({ ...base, source: { ...base.source, text: "另一段" } }, "");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("export stem is stable for identical content and changes with echo text", () => {
  const trace = sampleTrace();
  const stem1 = exportFileStemForTrace(trace, "");
  const stem2 = exportFileStemForTrace(trace, "");
  const stem3 = exportFileStemForTrace(trace, "新的复述");
  assert.equal(stem1, stem2);
  assert.notEqual(stem1, stem3);
  assert.match(stem1, /^20260816-0358-trace_abc123-[0-9a-f]{12}$/);
});

test("destination types are validated", () => {
  assert.equal(sanitizeDestinationType("folder"), "folder");
  assert.equal(sanitizeDestinationType("obsidian"), "obsidian");
  assert.equal(sanitizeDestinationType("dropbox"), null);
  assert.equal(sanitizeDestinationType(null), null);
});
