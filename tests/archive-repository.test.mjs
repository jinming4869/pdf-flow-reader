import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createArchiveRepository } from "../archive-repository.mjs";

function tempRepository() {
  const directory = mkdtempSync(join(tmpdir(), "archive-repo-test-"));
  const destination = join(directory, "vault");
  const repository = createArchiveRepository({
    configPath: join(directory, "config.json"),
    queuePath: join(directory, "queue.json"),
  });
  return { directory, destination, repository };
}

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

test("export writes markdown and crop png under a per-book directory", () => {
  const { directory, destination, repository } = tempRepository();
  try {
    repository.setDestination({ type: "folder", path: destination });
    const result = repository.exportTrace({
      trace: sampleTrace(),
      documentName: "测量与效度.pdf",
      echoText: "一句复述。",
      cropBytes: new Uint8Array([1, 2, 3, 4]),
    });
    assert.equal(result.status, "written");
    const bookDirectory = join(destination, "测量与效度.pdf");
    const files = readdirSync(bookDirectory).sort();
    assert.equal(files.length, 2);
    const markdown = files.find((file) => file.endsWith(".md"));
    const png = files.find((file) => file.endsWith(".png"));
    assert.ok(markdown);
    assert.ok(png);
    assert.equal(readFileSync(join(bookDirectory, png)).length, 4);
    assert.match(readFileSync(join(bookDirectory, markdown), "utf8"), /一段讨论测量效度/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("re-exporting identical content skips instead of rewriting", () => {
  const { directory, destination, repository } = tempRepository();
  try {
    repository.setDestination({ type: "folder", path: destination });
    const first = repository.exportTrace({
      trace: sampleTrace(),
      documentName: "书.pdf",
      cropBytes: new Uint8Array([1]),
    });
    const second = repository.exportTrace({
      trace: sampleTrace(),
      documentName: "书.pdf",
      cropBytes: new Uint8Array([1]),
    });
    assert.equal(first.status, "written");
    assert.equal(second.status, "skipped");
    assert.equal(first.filePath, second.filePath);
    const bookDirectory = join(destination, "书.pdf");
    assert.equal(readdirSync(bookDirectory).filter((file) => file.endsWith(".md")).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("changed echo text produces a new file and keeps the old one", () => {
  const { directory, destination, repository } = tempRepository();
  try {
    repository.setDestination({ type: "folder", path: destination });
    repository.exportTrace({
      trace: sampleTrace(),
      documentName: "书.pdf",
      echoText: "",
    });
    repository.exportTrace({
      trace: sampleTrace(),
      documentName: "书.pdf",
      echoText: "后来生成的复述。",
    });
    const bookDirectory = join(destination, "书.pdf");
    const markdownFiles = readdirSync(bookDirectory).filter((file) => file.endsWith(".md"));
    assert.equal(markdownFiles.length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("export without a destination fails with a stable error", () => {
  const { directory, repository } = tempRepository();
  try {
    assert.throws(
      () => repository.exportTrace({ trace: sampleTrace(), documentName: "书.pdf" }),
      (error) => error.code === "ARCHIVE_NO_DESTINATION",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("queue persists entries and counts bounded retries", () => {
  const { directory, repository } = tempRepository();
  try {
    repository.enqueue({ traceId: "trace-1", documentName: "书.pdf" });
    assert.equal(repository.dequeueOne().traceId, "trace-1");
    assert.equal(repository.dequeueOne(), null);

    repository.requeue({ traceId: "trace-1", documentName: "书.pdf", attempts: 0 }, "disk full");
    const snapshot = repository.queueSnapshot();
    assert.equal(snapshot.pending.length, 1);
    assert.equal(snapshot.pending[0].attempts, 1);
    assert.equal(snapshot.pending[0].lastError, "disk full");

    repository.requeue({ traceId: "trace-1", documentName: "书.pdf", attempts: 1 }, "disk full");
    repository.requeue({ traceId: "trace-1", documentName: "书.pdf", attempts: 2 }, "disk full");
    const after = repository.queueSnapshot();
    assert.equal(after.pending.length, 0);
    assert.equal(after.failed.length, 1);
    assert.equal(after.failed[0].attempts, 3);

    repository.retryFailed();
    const reset = repository.queueSnapshot();
    assert.equal(reset.pending.length, 1);
    assert.equal(reset.failed.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("queue state survives reload", () => {
  const { directory, destination, repository } = tempRepository();
  try {
    repository.setDestination({ type: "obsidian", path: destination });
    repository.enqueue({ traceId: "trace-9", documentName: "书.pdf" });

    const reloaded = createArchiveRepository({
      configPath: join(directory, "config.json"),
      queuePath: join(directory, "queue.json"),
    });
    assert.deepEqual(reloaded.destination(), { type: "obsidian", path: destination });
    assert.equal(reloaded.queueSnapshot().pending.length, 1);
    assert.equal(reloaded.queueSnapshot().pending[0].traceId, "trace-9");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("document directory names are sanitized for the filesystem", () => {
  const { directory, destination, repository } = tempRepository();
  try {
    repository.setDestination({ type: "folder", path: destination });
    const result = repository.exportTrace({
      trace: sampleTrace(),
      documentName: '标题/含:非法?字符*"的 书.pdf',
    });
    assert.equal(result.status, "written");
    assert.ok(existsSync(join(destination, "标题-含-非法-字符-的 书.pdf")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
