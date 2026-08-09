import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createTraceRepository } from "../trace-repository.mjs";

function fixture(t) {
  const rootPath = mkdtempSync(join(tmpdir(), "night-study-trace-repository-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));
  return { rootPath, repository: createTraceRepository({ rootPath }) };
}

function draftInput(id, overrides = {}) {
  return {
    id,
    documentId: "doc-a",
    documentFingerprint: "sha256:document-a",
    pageIndex: 2,
    lassoPath: [
      { x: 0.1, y: 0.2 },
      { x: 0.7, y: 0.2 },
      { x: 0.4, y: 0.8 },
    ],
    sourceText: "A local trace.",
    sourceProvenance: "native",
    speedTier: "long-day",
    speedPxPerSecond: 20,
    ...overrides,
  };
}

async function registerDocument(repository, overrides = {}) {
  return repository.registerDocument({
    id: "doc-a",
    fingerprint: "sha256:document-a",
    displayName: "A.pdf",
    lastKnownPath: "/books/A.pdf",
    fileSize: 1024,
    ...overrides,
  }, { now: new Date("2026-08-09T12:00:00Z") });
}

test("repository registers a document and atomically creates a readable draft", async (t) => {
  const { rootPath, repository } = fixture(t);
  await repository.initialize();
  const document = await registerDocument(repository);
  const trace = await repository.createDraft(draftInput("trace-1"), {
    now: new Date("2026-08-09T12:01:00Z"),
  });

  assert.equal(document.id, "doc-a");
  assert.equal(document.lastKnownPath, "/books/A.pdf");
  assert.equal(trace.readingContext.readingOrder, 1);
  assert.deepEqual(await repository.readTrace("doc-a", "trace-1"), trace);
  assert.deepEqual(await repository.listTraces("doc-a"), [trace]);

  const tracePath = join(rootPath, "documents", "doc-a", "traces", "trace-1", "trace.json");
  assert.equal(existsSync(tracePath), true);
  assert.equal(JSON.parse(readFileSync(tracePath, "utf8")).id, "trace-1");
  assert.equal(
    readdirSync(join(rootPath, "documents", "doc-a", "traces", "trace-1"))
      .some((name) => name.includes(".tmp-")),
    false,
  );
});

test("repository atomically stores a PNG crop and updates the trace reference", async (t) => {
  const { rootPath, repository } = fixture(t);
  await repository.initialize();
  await registerDocument(repository);
  const created = await repository.createDraft(draftInput("trace-crop"));
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

  const ready = await repository.saveCrop(
    "doc-a",
    "trace-crop",
    bytes,
    { mimeType: "image/png", width: 1200, height: 800 },
    { expectedRevision: created.revision, now: new Date("2026-08-09T12:02:00Z") },
  );
  assert.equal(ready.crop.state, "ready");
  assert.equal(ready.crop.reference, "traces/trace-crop/crop.png");
  assert.equal(ready.revision, 2);
  assert.deepEqual(
    [...readFileSync(join(rootPath, "documents", "doc-a", "traces", "trace-crop", "crop.png"))],
    [...bytes],
  );
  const readable = await repository.readCrop("doc-a", "trace-crop");
  assert.equal(readable.mimeType, "image/png");
  assert.equal(readable.width, 1200);
  assert.equal(readable.height, 800);
  assert.deepEqual([...readable.bytes], [...bytes]);
  await assert.rejects(repository.saveCrop(
    "doc-a",
    "trace-crop",
    bytes,
    { mimeType: "image/png", width: 1200, height: 800 },
    { expectedRevision: 1 },
  ), { code: "TRACE_REVISION_CONFLICT" });
});

test("document relocation preserves identity while a fingerprint mismatch is rejected", async (t) => {
  const { repository } = fixture(t);
  await repository.initialize();
  const first = await registerDocument(repository);
  const moved = await registerDocument(repository, { lastKnownPath: "/moved/A.pdf" });

  assert.equal(moved.createdAt, first.createdAt);
  assert.equal(moved.lastKnownPath, "/moved/A.pdf");
  await assert.rejects(
    registerDocument(repository, {
      fingerprint: "sha256:different-edition",
      lastKnownPath: "/books/revised-A.pdf",
    }),
    { code: "TRACE_DOCUMENT_IDENTITY_MISMATCH" },
  );
});

test("per-document write queue assigns monotonic reading order under concurrency", async (t) => {
  const { repository } = fixture(t);
  await repository.initialize();
  await registerDocument(repository);

  const created = await Promise.all(
    Array.from({ length: 5 }, (_, index) => repository.createDraft(
      draftInput(`trace-${index + 1}`),
      { now: new Date(`2026-08-09T12:0${index + 1}:00Z`) },
    )),
  );
  assert.deepEqual(
    created.map((trace) => trace.readingContext.readingOrder).sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    (await repository.listTraces("doc-a")).map((trace) => trace.readingContext.readingOrder),
    [1, 2, 3, 4, 5],
  );
});

test("stale document counter cannot duplicate an existing reading order", async (t) => {
  const { rootPath, repository } = fixture(t);
  await repository.initialize();
  await registerDocument(repository);
  const first = await repository.createDraft(draftInput("trace-first"));
  assert.equal(first.readingContext.readingOrder, 1);

  const documentPath = join(rootPath, "documents", "doc-a", "document.json");
  const document = JSON.parse(readFileSync(documentPath, "utf8"));
  document.nextReadingOrder = 1;
  writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const second = await repository.createDraft(draftInput("trace-second"));
  assert.equal(second.readingContext.readingOrder, 2);
});

test("optimistic revision prevents a late trace update from overwriting newer data", async (t) => {
  const { repository } = fixture(t);
  await repository.initialize();
  await registerDocument(repository);
  const created = await repository.createDraft(draftInput("trace-revision"));

  const failedCrop = await repository.transitionTrace(
    "doc-a",
    "trace-revision",
    { type: "CROP_FAILED", errorCode: "CANVAS_OOM" },
    { expectedRevision: created.revision, now: new Date("2026-08-09T12:03:00Z") },
  );
  assert.equal(failedCrop.revision, 2);

  await assert.rejects(
    repository.transitionTrace(
      "doc-a",
      "trace-revision",
      { type: "RETRY_CROP" },
      { expectedRevision: 1 },
    ),
    { code: "TRACE_REVISION_CONFLICT" },
  );
  assert.equal((await repository.readTrace("doc-a", "trace-revision")).crop.state, "failed");
});

test("recovery removes orphan temp files and quarantines corrupt trace JSON", async (t) => {
  const { rootPath, repository } = fixture(t);
  await repository.initialize();
  await registerDocument(repository);
  await repository.createDraft(draftInput("trace-good"));

  const corruptDirectory = join(rootPath, "documents", "doc-a", "traces", "trace-corrupt");
  mkdirSync(corruptDirectory, { recursive: true });
  writeFileSync(join(corruptDirectory, "trace.json"), "{ definitely not json", "utf8");
  writeFileSync(join(corruptDirectory, "trace.json.tmp-orphan"), "orphan", "utf8");

  const result = await repository.recover();
  assert.equal(result.removedTemps, 1);
  assert.equal(result.quarantined.length, 1);
  assert.equal(existsSync(join(corruptDirectory, "trace.json")), false);
  assert.equal(readdirSync(join(rootPath, "recovery")).length, 1);
  assert.deepEqual((await repository.listTraces("doc-a")).map((trace) => trace.id), ["trace-good"]);
});

test("recovery quarantines a corrupt document index so it can be registered again", async (t) => {
  const { rootPath, repository } = fixture(t);
  await repository.initialize();
  await registerDocument(repository);
  const documentPath = join(rootPath, "documents", "doc-a", "document.json");
  writeFileSync(documentPath, "{ corrupt document index", "utf8");

  const result = await repository.recover();
  assert.equal(result.quarantined.length, 1);
  assert.equal(existsSync(documentPath), false);
  const registered = await registerDocument(repository, { lastKnownPath: "/recovered/A.pdf" });
  assert.equal(registered.lastKnownPath, "/recovered/A.pdf");
});

test("trashed traces are hidden, restorable, and purged only after retention", async (t) => {
  const { rootPath, repository } = fixture(t);
  await repository.initialize();
  await registerDocument(repository);
  const created = await repository.createDraft(draftInput("trace-trash"));
  const trashed = await repository.transitionTrace(
    "doc-a",
    "trace-trash",
    { type: "TRASH" },
    { expectedRevision: created.revision, now: new Date("2026-01-01T00:00:00Z") },
  );
  assert.deepEqual(await repository.listTraces("doc-a"), []);
  assert.equal((await repository.listTraces("doc-a", { includeTrashed: true }))[0].lifecycle, "trashed");

  assert.deepEqual(await repository.purgeExpired({ now: new Date("2026-01-15T00:00:00Z") }), []);
  const restored = await repository.transitionTrace(
    "doc-a",
    "trace-trash",
    { type: "RESTORE" },
    { expectedRevision: trashed.revision, now: new Date("2026-01-16T00:00:00Z") },
  );
  assert.equal(restored.lifecycle, "draft");

  const trashedAgain = await repository.transitionTrace(
    "doc-a",
    "trace-trash",
    { type: "TRASH" },
    { expectedRevision: restored.revision, now: new Date("2026-01-17T00:00:00Z") },
  );
  const purged = await repository.purgeExpired({ now: new Date("2026-02-20T00:00:00Z") });
  assert.deepEqual(purged, [{ documentId: "doc-a", traceId: "trace-trash" }]);
  assert.equal(await repository.readTrace("doc-a", "trace-trash"), null);
  assert.equal(
    existsSync(join(rootPath, "documents", "doc-a", "traces", "trace-trash")),
    false,
  );
  assert.equal(trashedAgain.lifecycle, "trashed");
});

test("repository rejects path-like identifiers before touching the filesystem", async (t) => {
  const { repository } = fixture(t);
  await repository.initialize();
  await assert.rejects(repository.registerDocument({
    id: "../escape",
    fingerprint: "sha256:escape",
    displayName: "escape.pdf",
  }), { code: "TRACE_UNSAFE_ID" });
  await registerDocument(repository);
  await assert.rejects(repository.createDraft(draftInput("trace/escape")), {
    code: "TRACE_UNSAFE_ID",
  });
});
