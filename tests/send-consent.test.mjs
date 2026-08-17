import test from "node:test";
import assert from "node:assert/strict";

import {
  CONSENT_STORE_KEY,
  createEmptyConsentState,
  grantScope,
  isScopeGranted,
  readSendConsent,
  revokeScope,
  summarizeSendPayload,
  writeSendConsent,
} from "../send-consent.mjs";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test("echo scope needs no book consent (configured-once legacy)", () => {
  const state = createEmptyConsentState();
  assert.equal(isScopeGranted(state, "echo", "doc-1"), true);
  assert.equal(isScopeGranted(state, "echo", null), true);
});

test("review and lse scopes require explicit per-book grants", () => {
  let state = createEmptyConsentState();
  assert.equal(isScopeGranted(state, "review", "doc-1"), false);
  state = grantScope(state, "review", "doc-1");
  assert.equal(isScopeGranted(state, "review", "doc-1"), true);
  assert.equal(isScopeGranted(state, "review", "doc-2"), false);
  assert.equal(isScopeGranted(state, "lse", "doc-1"), false);
});

test("grants persist across reload and revoke removes only the target", () => {
  const storage = memoryStorage();
  let state = readSendConsent(storage);
  state = grantScope(state, "review", "doc-1");
  state = grantScope(state, "review", "doc-2");
  writeSendConsent(state, storage);

  const reloaded = readSendConsent(storage);
  assert.equal(isScopeGranted(reloaded, "review", "doc-1"), true);
  assert.equal(isScopeGranted(reloaded, "review", "doc-2"), true);

  const revoked = revokeScope(reloaded, "review", "doc-1");
  assert.equal(isScopeGranted(revoked, "review", "doc-1"), false);
  assert.equal(isScopeGranted(revoked, "review", "doc-2"), true);
});

test("granting a book-level scope never implies the wider lse scope", () => {
  let state = createEmptyConsentState();
  state = grantScope(state, "review", "doc-1");
  assert.equal(isScopeGranted(state, "lse", "doc-1"), false);
});

test("invalid scopes and document ids are rejected without state changes", () => {
  let state = createEmptyConsentState();
  const before = JSON.stringify(state);
  state = grantScope(state, "unknown", "doc-1");
  state = grantScope(state, "review", "");
  assert.equal(JSON.stringify(state), before);
});

test("payload summaries describe scope contents without embedding them", () => {
  const echo = summarizeSendPayload("echo", { textLength: 120, imageCount: 1 });
  assert.deepEqual(echo.lines, [
    "圈选文字约 120 字",
    "裁图 1 张",
    "不发送整书正文",
  ]);
  const review = summarizeSendPayload("review", { fullTextLength: 40000, traceCount: 8 });
  assert.ok(review.lines[0].includes("40000"));
  assert.ok(review.lines[1].includes("8 条"));
  assert.doesNotMatch(JSON.stringify(review), /40000字正文内容/);
});

test("corrupt consent storage falls back to empty", () => {
  const storage = memoryStorage();
  storage.setItem(CONSENT_STORE_KEY, "{broken");
  const state = readSendConsent(storage);
  assert.equal(isScopeGranted(state, "review", "doc-1"), false);
});
