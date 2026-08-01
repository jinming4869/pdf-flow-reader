// tts-controller.mjs — Hisheng master switch and executable tier policy

import {
  filterTextForPolicy,
  isChunkAllowedByPolicy,
  resolveHishengPolicy,
  shortcutActionForPolicy,
} from "./tts-policy.mjs";
import { planAestheticWalkUtterance } from "./tts-aesthetic-walk.mjs";
import {
  pickReadableChunk,
  pickReadableSentenceBelowLine,
} from "./tts-segment-picker.mjs";
import {
  advanceParagraphFlow,
  createParagraphFlowState,
} from "./tts-paragraph-flow.mjs";

const EXECUTABLE_AUTOMATIC_POLICIES = new Set(["continuous"]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function temporarySpeechSpeed(policy) {
  if (policy.speechRate?.mode === "follow-scroll") {
    return Number(policy.speechRate.min) || 1.5;
  }
  if (policy.tierKey === "snow-mist") return 1.18;
  return 1.25;
}

function transformedChunksForPolicy(chunks, policy, { explicitTarget = false } = {}) {
  return chunks
    .filter((chunk) => isChunkAllowedByPolicy(chunk, policy, { explicitTarget }))
    .map((chunk) => {
      const text = filterTextForPolicy(chunk.text, policy);
      return text === chunk.text ? chunk : { ...chunk, text };
    })
    .filter((chunk) => chunk.text);
}

function leadChunkFromPassage(passage) {
  const lead = passage?.leadSentence;
  if (!passage || !lead?.text) return null;
  return {
    source: lead.source ?? passage.source ?? "unknown",
    pageIndex: Math.max(0, Math.round(finiteNumber(lead.pageIndex))),
    chunkIndex: Math.max(0, Math.round(finiteNumber(passage.paragraphIndex))),
    text: lead.text,
    languageHint: lead.languageHint ?? passage.languageHint ?? "unknown",
    role: passage.role ?? "body",
    priority: finiteNumber(passage.priority, 1),
    qualityFlags: [...(passage.qualityFlags ?? [])],
    bbox: lead.bbox ?? null,
    readingBbox: lead.readingBbox ?? null,
    normalizedBbox: lead.normalizedBbox ?? null,
    paragraphKey: passage.paragraphKey,
    speechKey: lead.key,
  };
}

function eligibleParagraphsForPolicy(passages, policy) {
  return passages.filter((passage) => {
    const chunk = leadChunkFromPassage(passage);
    return chunk && isChunkAllowedByPolicy(chunk, policy);
  });
}

export function canRequestManualSpeech({
  readyToMove = false,
  hasActivePdf = false,
  controlAllowed = false,
  policy = null,
  action = null,
  hasReadableChunks = false,
} = {}) {
  return Boolean(
    readyToMove &&
    hasActivePdf &&
    controlAllowed &&
    policy?.enabled &&
    policy.manual?.action === action &&
    hasReadableChunks
  );
}

export async function runManualSpeechRequest({
  canRequest,
  warmup,
  requestAction,
  onReady,
} = {}) {
  if (typeof canRequest !== "function" || !canRequest()) return false;
  const ready = typeof warmup === "function" ? await warmup() : true;
  if (ready === false || !canRequest()) return false;
  if (typeof requestAction !== "function" || !requestAction()) return false;
  await onReady?.();
  return true;
}

export function cancelTtsSession({
  controller,
  scheduler,
  audioPlayer,
  clearFocus,
  setUtteranceLocked,
} = {}, reason = "cancelled", {
  reset = false,
  fade = true,
} = {}) {
  const controllerAction = reset ? controller?.reset : controller?.stop;
  if (typeof controllerAction === "function") {
    controllerAction.call(controller, reason);
  } else {
    scheduler?.cancel?.(reason);
  }
  scheduler?.releasePlaybackLock?.(reason);
  audioPlayer?.stop?.({ reason, fade });
  clearFocus?.();
  setUtteranceLocked?.(false);
}

export function createTtsController({
  scheduler,
  minPriority = 0.5,
  getSpeedTier,
  onStateChange,
} = {}) {
  let enabled = false;
  let generation = 0;
  let lastChunkKey = null;
  let manualArmedAction = null;
  let manualTarget = null;
  let paragraphFlowState = createParagraphFlowState();

  function getPolicy() {
    return resolveHishengPolicy({
      enabled,
      tierKey: getSpeedTier?.() ?? "long-day",
    });
  }

  function emit(extra = {}) {
    const policy = getPolicy();
    onStateChange?.({
      enabled,
      generation,
      tierKey: policy.tierKey,
      policy,
      behavior: enabled ? policy.behavior : "希声静默",
      manualArmedAction,
      manualTargetKey: manualTarget?.speechKey ?? null,
      ...extra,
    });
  }

  function clearSessionState() {
    generation += 1;
    manualArmedAction = null;
    manualTarget = null;
    lastChunkKey = null;
    paragraphFlowState = createParagraphFlowState();
  }

  function setEnabled(nextEnabled) {
    const next = Boolean(nextEnabled);
    if (next === enabled) return enabled;
    enabled = next;
    clearSessionState();
    if (enabled) scheduler?.cancel?.("master-on");
    else scheduler?.reset?.("master-off");
    emit({ reason: enabled ? "master-on" : "master-off" });
    return enabled;
  }

  function toggleEnabled() {
    return setEnabled(!enabled);
  }

  function canSpeakChunk(chunk, { explicitTarget = false } = {}) {
    return isChunkAllowedByPolicy(chunk, getPolicy(), { explicitTarget });
  }

  function tickParagraphFlow({
    isPlaying,
    paragraphs,
    readingPosition,
    paragraphContextKey,
    documentGeneration,
    jumped,
    policy,
  }) {
    const eligibleParagraphs = eligibleParagraphsForPolicy(paragraphs, policy);
    const preparedSnapshot = scheduler?.snapshot?.()?.prefetch;
    const readyPreparedKey = preparedSnapshot?.kind === "explicit" && preparedSnapshot.ready
      ? preparedSnapshot.key
      : null;
    const advanced = advanceParagraphFlow(paragraphFlowState, {
      contextKey: paragraphContextKey,
      position: readingPosition,
      isPlaying,
      passages: eligibleParagraphs,
      readyPreparedKey,
      jumped,
    });
    paragraphFlowState = advanced.state;
    const results = [];
    const speech = {
      tierKey: policy.tierKey,
      speed: temporarySpeechSpeed(policy),
      manual: false,
      paragraphLead: true,
      prefetchNext: false,
      firstSentenceOnly: false,
      allowFootnote: false,
      requireLead: true,
    };

    for (const action of advanced.actions) {
      if (action.type === "prepare") {
        const chunk = leadChunkFromPassage(action.target);
        const pick = chunk
          ? {
              key: action.key,
              chunk,
              normalizedReadingY: finiteNumber(chunk.normalizedBbox?.y),
              distance: 0,
            }
          : null;
        results.push(scheduler?.prepare?.({
          key: action.key,
          pick,
          pageNumber: finiteNumber(chunk?.pageIndex) + 1,
          documentGeneration,
          contextKey: paragraphContextKey,
          speech,
        }) ?? { key: action.key, status: "missing" });
      } else if (action.type === "play-prepared") {
        results.push(scheduler?.playPrepared?.({
          key: action.key,
          contextKey: paragraphContextKey,
        }) ?? { key: action.key, status: "missing" });
      } else if (action.type === "discard-prepared") {
        scheduler?.discardPrepared?.(action.reason, { key: action.key });
        results.push({ key: action.key, status: action.reason });
      }
    }

    if (advanced.actions.length) {
      emit({
        status: results.some((result) => result?.status === "played")
          ? "speaking"
          : "paragraph-flow",
      });
      return { actions: advanced.actions, results };
    }
    return null;
  }

  async function tick({
    isPlaying = false,
    chunks = [],
    prefetchChunks = [],
    normalizedReadingY = 0.38,
    pageNumber = 0,
    documentGeneration = 0,
    paragraphs = [],
    readingPosition = null,
    paragraphContextKey = null,
    jumped = false,
    pageHeightPx = 0,
    scrollPxPerSecond = 0,
    nowMs = Date.now(),
  } = {}) {
    const policy = getPolicy();
    if (!policy.enabled) return null;
    if (policy.autoRead === "paragraph-lead") {
      return tickParagraphFlow({
        isPlaying,
        paragraphs,
        readingPosition,
        paragraphContextKey: paragraphContextKey ?? `${documentGeneration}:${generation}`,
        documentGeneration,
        jumped,
        policy,
      });
    }

    const manualAction = manualArmedAction;
    const explicitManualTarget = manualTarget;
    const manual = Boolean(manualAction);
    const automatic = EXECUTABLE_AUTOMATIC_POLICIES.has(policy.autoRead);
    if (!manual && !automatic) return null;
    if (!isPlaying && !manual) {
      scheduler?.cancel?.("paused");
      return null;
    }

    const sourceChunks = explicitManualTarget ? [explicitManualTarget] : chunks;
    let eligibleChunks = transformedChunksForPolicy(sourceChunks, policy, {
      explicitTarget: manual,
    });
    const eligiblePrefetchChunks = !manual && policy.tierKey === "snow-mist"
      ? transformedChunksForPolicy(prefetchChunks, policy)
      : [];
    if (!manual && policy.tierKey === "aesthetic-walk") {
      eligibleChunks = eligibleChunks.map((chunk) => ({
        ...chunk,
        utterancePlan: planAestheticWalkUtterance({
          chunk,
          text: chunk.text,
          normalizedReadingY,
          pageHeightPx,
          scrollPxPerSecond,
          nowMs,
          minRate: policy.speechRate?.min,
          maxRate: policy.speechRate?.max,
        }),
      }));
    }
    const pick = manualAction === "point-sentence"
      ? (
          eligibleChunks[0]
            ? {
                key: eligibleChunks[0].speechKey ?? `${eligibleChunks[0].source ?? "unknown"}:${eligibleChunks[0].pageIndex ?? 0}:${eligibleChunks[0].chunkIndex ?? 0}`,
                chunk: eligibleChunks[0],
                normalizedReadingY,
                distance: 0,
              }
            : null
        )
      : manualAction === "read-line-sentence"
      ? pickReadableSentenceBelowLine(eligibleChunks, {
          normalizedReadingY,
          minPriority,
        })
      : pickReadableChunk(eligibleChunks, {
          normalizedReadingY,
          minPriority,
        });
    if (!pick?.chunk) {
      emit({ status: "waiting-for-readable-chunk" });
      return null;
    }
    if (!manual && pick.key === lastChunkKey) return null;
    if (!manual && pick.chunk.utterancePlan?.decision === "skip") {
      lastChunkKey = pick.key;
      emit({ status: "visual-skip", chunkKey: pick.key });
      return { ...pick, status: "visual-skip", skipped: true };
    }

    const runGeneration = generation;
    manualArmedAction = null;
    manualTarget = null;
    const schedulerChunks = manualAction === "read-line-sentence"
      ? [pick.chunk]
      : eligibleChunks;
    const schedulerReadingY = manualAction === "read-line-sentence"
      ? (
          finiteNumber(pick.chunk.normalizedBbox?.y) +
          finiteNumber(pick.chunk.normalizedBbox?.height) / 2
        )
      : normalizedReadingY;
    const result = await scheduler?.update({
      isPlaying: true,
      chunks: schedulerChunks,
      prefetchChunks: eligiblePrefetchChunks,
      normalizedReadingY: schedulerReadingY,
      pageNumber,
      documentGeneration,
      speech: {
        tierKey: policy.tierKey,
        speed: pick.chunk.utterancePlan?.speed ?? temporarySpeechSpeed(policy),
        utterancePlan: pick.chunk.utterancePlan ?? null,
        manual,
        action: manualAction,
        requestId: pick.chunk.pointReadRequestId ?? null,
        prefetchNext: Boolean(policy.prefetch.enabled && !manual),
        firstSentenceOnly: manualAction === "read-line-sentence",
        allowFootnote: !policy.filter.excludedRoles.includes("footnote"),
        requireLead: false,
      },
    });

    if (runGeneration !== generation) return null;
    if (result?.chunk) {
      lastChunkKey = result.key;
      emit({
        status: result.skipped ? result.status ?? "late-skip" : "speaking",
        chunkKey: result.key,
      });
    }
    return result;
  }

  function requestAction(action) {
    const policy = getPolicy();
    if (!policy.enabled || policy.manual.action !== action) return false;
    manualArmedAction = action;
    lastChunkKey = null;
    emit({ reason: action });
    return true;
  }

  function requestTarget(action, target) {
    const policy = getPolicy();
    if (
      !policy.enabled ||
      policy.manual.action !== action ||
      action !== "point-sentence" ||
      !target ||
      !canSpeakChunk(target, { explicitTarget: true })
    ) {
      return false;
    }
    manualArmedAction = action;
    manualTarget = target;
    lastChunkKey = null;
    emit({ reason: action, targetKey: target.speechKey ?? null });
    return true;
  }

  function stop(reason = "manual-stop") {
    clearSessionState();
    scheduler?.cancel?.(reason);
    emit({ status: "stopped" });
  }

  function reset(reason = "reset") {
    clearSessionState();
    scheduler?.reset?.(reason);
    emit({ reason });
  }

  function snapshot() {
    const policy = getPolicy();
    return {
      enabled,
      generation,
      tierKey: policy.tierKey,
      policy,
      behavior: enabled ? policy.behavior : "希声静默",
      manualArmedAction,
      manualTargetKey: manualTarget?.speechKey ?? null,
      lastChunkKey,
      paragraphFlow: {
        contextKey: paragraphFlowState.contextKey,
        position: paragraphFlowState.position,
        preparedKey: paragraphFlowState.preparedKey,
        handledCount: paragraphFlowState.handledParagraphKeys.length,
      },
    };
  }

  return {
    setEnabled,
    toggleEnabled,
    isEnabled: () => enabled,
    getGeneration: () => generation,
    getPolicy,
    shortcutAction: (code) => shortcutActionForPolicy({ code, policy: getPolicy() }),
    canSpeakChunk,
    tick,
    requestAction,
    requestTarget,
    stop,
    reset,
    snapshot,
  };
}
