import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTtsPreferences,
  ttsProviderConfigFromPreferences,
  updateTtsPreferences,
} from "../tts-preferences.mjs";

test("normalizeTtsPreferences defaults to a disabled and muted master", () => {
  const preferences = normalizeTtsPreferences({});
  assert.equal(preferences.ttsEnabled, false);
  assert.equal(preferences.ttsMuted, true);
  assert.equal(preferences.ttsProviderMode, "local");
  assert.equal("ttsMode" in preferences, false);
  assert.equal("ttsPreferredMode" in preferences, false);
  assert.equal("ttsConsentGiven" in preferences, false);
});

test("normalizeTtsPreferences migrates old modes to one boolean master", () => {
  assert.equal(normalizeTtsPreferences({ ttsMode: "off" }).ttsEnabled, false);
  assert.equal(normalizeTtsPreferences({ ttsMode: "whisper" }).ttsEnabled, true);
  assert.equal(normalizeTtsPreferences({ ttsMode: "flow" }).ttsEnabled, true);
  assert.equal(normalizeTtsPreferences({ ttsMode: "unknown" }).ttsEnabled, false);
  assert.equal(
    normalizeTtsPreferences({ ttsEnabled: false, ttsMode: "flow" }).ttsEnabled,
    false,
  );
  assert.equal(
    normalizeTtsPreferences({ ttsEnabled: true, ttsMode: "off" }).ttsEnabled,
    true,
  );
});

test("normalizeTtsPreferences clamps volume", () => {
  assert.equal(normalizeTtsPreferences({ ttsVolume: 2 }).ttsVolume, 1);
  assert.equal(normalizeTtsPreferences({ ttsVolume: -1 }).ttsVolume, 0);
});

test("normalizeTtsPreferences migrates the legacy API consent field once", () => {
  const migrated = normalizeTtsPreferences({ ttsConsentGiven: true });
  assert.equal(migrated.openaiTtsConsentGiven, true);
  assert.equal("ttsConsentGiven" in migrated, false);
  assert.equal(
    normalizeTtsPreferences({
      openaiTtsConsentGiven: false,
      ttsConsentGiven: true,
    }).openaiTtsConsentGiven,
    false,
  );
});

test("provider config uses local unless API key and consent exist", () => {
  assert.equal(
    ttsProviderConfigFromPreferences({
      ttsProviderMode: "api",
      openaiTtsApiKey: "sk",
    }).openaiApiKey,
    null,
  );
  assert.equal(
    ttsProviderConfigFromPreferences({
      ttsProviderMode: "api",
      openaiTtsApiKey: "sk",
      openaiTtsConsentGiven: true,
    }).openaiApiKey,
    "sk",
  );
});

test("provider config prefers an injected system credential over the legacy field", () => {
  const preferences = {
    ttsProviderMode: "api",
    openaiTtsApiKey: "sk-legacy",
    openaiTtsConsentGiven: true,
  };
  assert.equal(
    ttsProviderConfigFromPreferences(preferences, { credentialApiKey: "sk-keychain" }).openaiApiKey,
    "sk-keychain",
  );
  // 凭据不可用时注入 null，旧字段不再被使用。
  assert.equal(
    ttsProviderConfigFromPreferences(preferences, { credentialApiKey: null }).openaiApiKey,
    null,
  );
  assert.equal(
    ttsProviderConfigFromPreferences(preferences, { credentialApiKey: "" }).openaiApiKey,
    null,
  );
});

test("updateTtsPreferences preserves local state and stores only the boolean master", () => {
  const state = {
    documents: {},
    preferences: { ttsMode: "flow", ttsVolume: 0.2 },
  };
  const next = updateTtsPreferences(state, {
    ttsEnabled: false,
    ttsVolume: 0.8,
  });
  assert.equal(next.documents, state.documents);
  assert.equal(next.preferences.ttsEnabled, false);
  assert.equal(next.preferences.ttsVolume, 0.8);
  assert.equal("ttsMode" in next.preferences, false);
});
