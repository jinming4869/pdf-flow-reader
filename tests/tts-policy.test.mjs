import test from "node:test";
import assert from "node:assert/strict";

import {
  filterTextForPolicy,
  HISHENG_TIER_POLICIES,
  isChunkAllowedByPolicy,
  masterEnabledFromPreferences,
  policyForTier,
  resolveHishengPolicy,
  shouldCancelPolicyTransition,
  shouldPreserveContinuousSpeechOnPageChange,
  shortcutActionForPolicy,
} from "../tts-policy.mjs";

const TIER_KEYS = [
  "snow-mist",
  "aesthetic-walk",
  "long-day",
  "winding-stream",
  "strong-wind",
  "all-things-flourish",
];

test("all six tiers expose complete deeply frozen policies", () => {
  assert.deepEqual(Object.keys(HISHENG_TIER_POLICIES), TIER_KEYS);
  for (const tierKey of TIER_KEYS) {
    const policy = policyForTier(tierKey);
    assert.equal(policy.tierKey, tierKey);
    assert.equal(Object.isFrozen(policy), true);
    for (const key of [
      "readingLine",
      "trigger",
      "utterance",
      "speechRate",
      "prefetch",
      "filter",
      "manual",
      "controls",
      "playback",
    ]) {
      assert.equal(typeof policy[key], "object", `${tierKey}.${key}`);
      assert.equal(Object.isFrozen(policy[key]), true, `${tierKey}.${key} frozen`);
    }
    assert.equal(Object.isFrozen(policy.filter.excludedRoles), true);
    assert.equal(policy.playback.allowOverlap, false);
    assert.equal(policy.playback.cancelOnPolicyChange, true);
  }
});

test("unknown tiers fall back to the quiet long-day policy", () => {
  assert.equal(policyForTier("unknown").tierKey, "long-day");
  assert.equal(policyForTier().tierKey, "long-day");
});

test("master off disables every effective speech trigger without losing placement", () => {
  for (const tierKey of TIER_KEYS) {
    const policy = resolveHishengPolicy({ enabled: false, tierKey });
    assert.equal(policy.enabled, false);
    assert.equal(policy.autoRead, "none");
    assert.equal(policy.readingLine.visible, false);
    assert.equal(policy.prefetch.enabled, false);
    assert.equal(policy.manual.action, null);
    assert.equal(policy.manual.shortcut, null);
    assert.equal(policy.controls.masterPlacement, policyForTier(tierKey).controls.masterPlacement);
    assert.equal(
      policy.controls.pointReadControlVisible,
      policyForTier(tierKey).controls.pointReadControlVisible,
    );
  }
});

test("only the intended tiers auto-read, show the line, accept R, or show point read", () => {
  const policies = Object.fromEntries(
    TIER_KEYS.map((tierKey) => [
      tierKey,
      resolveHishengPolicy({ enabled: true, tierKey }),
    ]),
  );
  assert.deepEqual(
    TIER_KEYS.filter((key) => policies[key].autoRead !== "none"),
    ["snow-mist", "aesthetic-walk", "winding-stream"],
  );
  assert.deepEqual(
    TIER_KEYS.filter((key) => policies[key].readingLine.visible),
    ["long-day"],
  );
  assert.deepEqual(
    TIER_KEYS.filter((key) => shortcutActionForPolicy({ code: "KeyR", policy: policies[key] })),
    ["long-day"],
  );
  assert.deepEqual(
    TIER_KEYS.filter((key) => policies[key].controls.pointReadControlVisible),
    ["strong-wind", "all-things-flourish"],
  );
});

test("H always means toggle master while R belongs only to enabled long-day", () => {
  for (const tierKey of TIER_KEYS) {
    const policy = resolveHishengPolicy({ enabled: true, tierKey });
    assert.equal(
      shortcutActionForPolicy({ code: "KeyH", policy }),
      "toggle-master",
    );
  }
  assert.equal(
    shortcutActionForPolicy({
      code: "KeyR",
      policy: resolveHishengPolicy({ enabled: true, tierKey: "long-day" }),
    }),
    "read-line-sentence",
  );
  assert.equal(
    shortcutActionForPolicy({
      code: "KeyR",
      policy: resolveHishengPolicy({ enabled: false, tierKey: "long-day" }),
    }),
    null,
  );
});

test("slow, walking, and winding policies encode their distinct prefetch contracts", () => {
  const snow = policyForTier("snow-mist");
  const walk = policyForTier("aesthetic-walk");
  const winding = policyForTier("winding-stream");

  assert.deepEqual(snow.speechRate, { mode: "comfortable" });
  assert.equal(snow.prefetch.target, "next-readable-chunk");
  assert.deepEqual(walk.speechRate, { mode: "follow-scroll", min: 1.5, max: 2.5 });
  assert.equal(walk.utterance.latePolicy, "shorten-at-sentence-or-skip");
  assert.equal(winding.autoRead, "paragraph-lead");
  assert.equal(winding.trigger.prefetch, "paragraph-start-crossed");
  assert.equal(winding.trigger.play, "paragraph-tail-crossed");
  assert.equal(winding.utterance.oncePer, "paragraph");
  assert.equal(winding.utterance.latePolicy, "skip");
});

test("only normal adjacent forward snow-mist page changes preserve continuous speech", () => {
  const base = {
    enabled: true,
    tierKey: "snow-mist",
    previousPage: 4,
    nextPage: 5,
    direction: 1,
    jumped: false,
  };
  assert.equal(shouldPreserveContinuousSpeechOnPageChange(base), true);
  assert.equal(shouldPreserveContinuousSpeechOnPageChange({ ...base, nextPage: 6 }), false);
  assert.equal(shouldPreserveContinuousSpeechOnPageChange({ ...base, direction: -1 }), false);
  assert.equal(shouldPreserveContinuousSpeechOnPageChange({ ...base, jumped: true }), false);
  assert.equal(shouldPreserveContinuousSpeechOnPageChange({ ...base, enabled: false }), false);
  assert.equal(shouldPreserveContinuousSpeechOnPageChange({ ...base, tierKey: "aesthetic-walk" }), false);
});

test("walking policy filters footnotes, annotations, and balanced parentheticals", () => {
  const policy = policyForTier("aesthetic-walk");
  const body = {
    text: "正文（旁注）继续。",
    role: "body",
    priority: 1,
    normalizedBbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
  };
  assert.equal(isChunkAllowedByPolicy(body, policy), true);
  assert.equal(
    isChunkAllowedByPolicy({ ...body, role: "footnote" }, policy),
    false,
  );
  assert.equal(
    isChunkAllowedByPolicy({ ...body, role: "annotation" }, policy),
    false,
  );
  assert.equal(filterTextForPolicy(body.text, policy), "正文继续。");
  assert.equal(
    filterTextForPolicy("正文（未完成的旁注", policy),
    "正文（未完成的旁注",
  );
});

test("old mode values migrate only to a master boolean", () => {
  assert.equal(masterEnabledFromPreferences({ ttsMode: "off" }), false);
  assert.equal(masterEnabledFromPreferences({ ttsMode: "whisper" }), true);
  assert.equal(masterEnabledFromPreferences({ ttsMode: "flow" }), true);
  assert.equal(masterEnabledFromPreferences({ ttsMode: "unknown" }), false);
  assert.equal(masterEnabledFromPreferences({}), false);
  assert.equal(
    masterEnabledFromPreferences({ ttsEnabled: false, ttsMode: "flow" }),
    false,
  );
  assert.equal(
    masterEnabledFromPreferences({ ttsEnabled: true, ttsMode: "off" }),
    true,
  );
});

test("only an enabled cross-tier transition requires session cancellation", () => {
  assert.equal(
    shouldCancelPolicyTransition({
      enabled: true,
      previousTierKey: "long-day",
      nextTierKey: "snow-mist",
    }),
    true,
  );
  assert.equal(
    shouldCancelPolicyTransition({
      enabled: true,
      previousTierKey: "long-day",
      nextTierKey: "long-day",
    }),
    false,
  );
  assert.equal(
    shouldCancelPolicyTransition({
      enabled: false,
      previousTierKey: "long-day",
      nextTierKey: "snow-mist",
    }),
    false,
  );
});
