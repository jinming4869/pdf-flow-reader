import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_PROMPTS,
  PROMPT_STORE_KEY,
  readCustomPrompts,
  resetCustomPrompt,
  resolvePrompt,
  saveCustomPrompt,
} from "../prompt-templates.mjs";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test("builtin echo prompt resolves by default and never changes at runtime", () => {
  const resolved = resolvePrompt("echo", memoryStorage());
  assert.equal(resolved.source, "builtin");
  assert.equal(resolved.version, 1);
  assert.equal(resolved.text, BUILTIN_PROMPTS.echo.text);
  Object.isFrozen(BUILTIN_PROMPTS);
});

test("a user copy overrides the builtin without mutating it", () => {
  const storage = memoryStorage();
  saveCustomPrompt("echo", "我的自定义提示词。", storage);
  const resolved = resolvePrompt("echo", storage);
  assert.equal(resolved.source, "custom");
  assert.equal(resolved.text, "我的自定义提示词。");
  assert.equal(BUILTIN_PROMPTS.echo.text.includes("朗读回响助手"), true);
});

test("custom prompts persist across reads and reset returns to builtin", () => {
  const storage = memoryStorage();
  saveCustomPrompt("echo", "自定义。", storage);
  assert.equal(readCustomPrompts(storage).echo.text, "自定义。");
  resetCustomPrompt("echo", storage);
  assert.equal(resolvePrompt("echo", storage).source, "builtin");
});

test("custom prompts keep no api keys by contract test (value fields only)", () => {
  const storage = memoryStorage();
  saveCustomPrompt("echo", "纯文本提示词", storage);
  const raw = storage.getItem(PROMPT_STORE_KEY);
  assert.doesNotMatch(raw, /sk-/);
});

test("invalid roles and empty text are rejected", () => {
  const storage = memoryStorage();
  assert.throws(() => saveCustomPrompt("analysis", "文本", storage));
  assert.throws(() => saveCustomPrompt("echo", "   ", storage));
  assert.equal(resolvePrompt("analysis", storage), null);
});

test("corrupt storage falls back to builtin", () => {
  const storage = memoryStorage();
  storage.setItem(PROMPT_STORE_KEY, "{broken");
  assert.equal(resolvePrompt("echo", storage).source, "builtin");
});
