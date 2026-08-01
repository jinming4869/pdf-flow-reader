// tts-preferences.mjs — 希声总开关与 Provider 偏好

import { masterEnabledFromPreferences } from "./tts-policy.mjs";

export const DEFAULT_TTS_PREFERENCES = Object.freeze({
  ttsEnabled: false,
  ttsVolume: 0.42,
  ttsMuted: true,
  ttsProviderMode: "local", // local | api
  ttsLocalProvider: "kokoro-local",
  ttsVoiceEn: "af_heart",
  ttsVoiceZh: "af_heart",
  ttsVoiceJa: "af_heart",
  openaiTtsApiKey: "",
  openaiTtsVoice: "marin",
  openaiTtsConsentGiven: false,
});

export function normalizeTtsPreferences(preferences = {}) {
  const ttsEnabled = masterEnabledFromPreferences(preferences);
  const openaiTtsConsentGiven = typeof preferences.openaiTtsConsentGiven === "boolean"
    ? preferences.openaiTtsConsentGiven
    : Boolean(preferences.ttsConsentGiven);
  const next = { ...DEFAULT_TTS_PREFERENCES, ...preferences };
  next.ttsEnabled = ttsEnabled;
  next.openaiTtsConsentGiven = openaiTtsConsentGiven;
  delete next.ttsMode;
  delete next.ttsPreferredMode;
  delete next.ttsConsentGiven;
  next.ttsVolume = Math.max(0, Math.min(1, Number(next.ttsVolume ?? DEFAULT_TTS_PREFERENCES.ttsVolume)));
  next.ttsMuted = Boolean(next.ttsMuted);
  next.ttsProviderMode = next.ttsProviderMode === "api" ? "api" : "local";
  return next;
}

export function ttsProviderConfigFromPreferences(preferences = {}) {
  const p = normalizeTtsPreferences(preferences);
  const canUseApi = p.ttsProviderMode === "api" && p.openaiTtsConsentGiven && Boolean(p.openaiTtsApiKey);
  return {
    kokoroEnabled: p.ttsProviderMode !== "api" || !canUseApi,
    openaiApiKey: canUseApi ? p.openaiTtsApiKey : null,
    openaiVoice: p.openaiTtsVoice,
  };
}

export function updateTtsPreferences(localState, patch = {}) {
  return {
    ...localState,
    preferences: normalizeTtsPreferences({
      ...(localState?.preferences ?? {}),
      ...patch,
    }),
  };
}
