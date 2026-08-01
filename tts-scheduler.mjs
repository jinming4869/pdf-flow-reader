import { pickReadableChunk, previewPickedChunk } from "./tts-segment-picker.mjs";
import { firstSentence } from "./tts-sentence.mjs";
import {
  aestheticWalkPlanSignature,
  isAestheticWalkPlanLate,
} from "./tts-aesthetic-walk.mjs";

function abortError() {
  return new DOMException("TTS 已取消", "AbortError");
}

function keyForChunk(chunk) {
  if (!chunk) return null;
  return `${chunk.source ?? "unknown"}:${chunk.pageIndex ?? 0}:${chunk.chunkIndex ?? 0}`;
}

function isPageMarginNoise(chunk) {
  const box = chunk?.normalizedBbox;
  if (!box) return false;
  const yStart = Number(box.y) || 0;
  const yEnd = yStart + (Number(box.height) || 0);
  const text = String(chunk?.text ?? "").trim();
  return text.length <= 120 && (yStart < 0.055 || yEnd > 0.945);
}

function isHeadingOrShortLead(chunk) {
  const role = chunk?.role;
  const len = String(chunk?.text ?? "").trim().length;
  return role === "heading" || len <= 90;
}

function isTtsEligibleChunk(chunk, speech = null) {
  if (!chunk?.text?.trim()) return false;
  if (["reference", "table", "formula"].includes(chunk.role)) return false;
  if (chunk.qualityFlags?.includes?.("bibliographic")) return false;
  if (isPageMarginNoise(chunk)) return false;
  if (chunk.role === "footnote" && !speech?.allowFootnote) return false;
  if (speech?.requireLead && !isHeadingOrShortLead(chunk)) return false;
  return true;
}

export function trimTextForSpeech(text = "", speech = null) {
  // ReadableChunk 已经负责把 PDF 文本整理成可朗读短段。
  // 只有第四档“流觞曲水”采用自然段首句策略。
  const normalized = String(text).replace(/\s+/g, " ").trim();
  return speech?.firstSentenceOnly ? firstSentence(normalized) : normalized;
}

function speechForChunk(speech = null, chunk = null) {
  if (!speech) return null;
  const { utterancePlan: _previousPlan, ...baseSpeech } = speech;
  const utterancePlan = chunk?.utterancePlan ?? null;
  if (!utterancePlan) return baseSpeech;
  return {
    ...baseSpeech,
    speed: Number(utterancePlan.speed) || baseSpeech.speed,
    utterancePlan,
  };
}

function textForSpeech(chunk, speech = null) {
  if (typeof speech?.utterancePlan?.text === "string") {
    return speech.utterancePlan.text;
  }
  return trimTextForSpeech(chunk?.text, speech);
}

function prefetchPlanSignature(pick, speech = null) {
  if (!pick?.chunk) return null;
  return [
    pick.key ?? keyForChunk(pick.chunk),
    textForSpeech(pick.chunk, speech),
    Number(speech?.speed) || 0,
    aestheticWalkPlanSignature(speech?.utterancePlan) ?? "",
  ].join("|");
}

function skippedPick(pick, status) {
  return pick?.chunk ? { ...pick, status, skipped: true } : null;
}

export function createTtsScheduler({
  provider,
  minPriority = 0.5,
  onPick,
  onResult,
  now = () => Date.now(),
} = {}) {
  let generation = 0;
  let activeController = null;
  let currentKey = null;
  let lastPick = null;
  let lastResult = null;
  let status = "idle";
  let queued = 0;
  let completed = 0;
  let cancelled = 0;
  let failed = 0;
  let lastSpeech = null;
  let playbackLocked = false;
  let prefetch = null;
  let prefetchQueued = 0;
  let prefetchCompleted = 0;
  let prefetchUsed = 0;
  let prefetchFailed = 0;

  function speechIsLate(speech) {
    return isAestheticWalkPlanLate(speech?.utterancePlan, {
      nowMs: now(),
    });
  }

  function markSkipped(pick, speech, reason = "late-skip") {
    currentKey = pick?.key ?? null;
    lastPick = pick;
    lastSpeech = speech;
    playbackLocked = false;
    status = reason;
    return skippedPick(pick, reason);
  }

  function abortPrefetch(reason = "prefetch-discarded", {
    key = null,
    contextKey = null,
    cancelProvider = true,
  } = {}) {
    if (!prefetch) return false;
    if (key && prefetch.key !== key) return false;
    if (contextKey && prefetch.contextKey !== contextKey) return false;
    const discarded = prefetch;
    prefetch = null;
    if (!discarded.controller.signal.aborted) discarded.controller.abort();
    if (cancelProvider) provider?.cancel?.();
    status = reason;
    return true;
  }

  function cancel(reason = "cancelled") {
    generation += 1;
    if (activeController) {
      activeController.abort();
      activeController = null;
      cancelled += 1;
    }
    if (prefetch?.controller) {
      prefetch.controller.abort();
      prefetch = null;
    }
    provider?.cancel?.();
    status = reason;
  }

  function nextPrefetchPick(chunks = [], currentKeyValue, speech = null) {
    if (!speech?.prefetchNext) return null;
    const ordered = [...chunks]
      .filter((chunk) => keyForChunk(chunk))
      .sort((a, b) => (Number(a.pageIndex) - Number(b.pageIndex)) || (Number(a.chunkIndex) - Number(b.chunkIndex)));
    const index = ordered.findIndex((chunk) => keyForChunk(chunk) === currentKeyValue);
    if (index < 0) return null;
    for (const chunk of ordered.slice(index + 1)) {
      if (isTtsEligibleChunk(chunk, speech)) {
        return { chunk, key: keyForChunk(chunk) };
      }
    }
    return null;
  }

  function startPrefetch({ chunks = [], currentPick, pageNumber = 0, documentGeneration = 0, speech = null } = {}) {
    if (!provider || !speech?.prefetchNext || !currentPick?.key) return;
    const pick = nextPrefetchPick(chunks, currentPick.key, speech);
    if (!pick || prefetch?.key === pick.key) return;
    const plannedSpeech = speechForChunk(speech, pick.chunk);
    if (plannedSpeech?.utterancePlan?.decision === "skip") return;
    const targetPageNumber = Number.isInteger(pick.chunk?.pageIndex)
      ? pick.chunk.pageIndex + 1
      : pageNumber;
    const controller = new AbortController();
    prefetchQueued += 1;
    const runGeneration = generation;
    const slot = {
      kind: "continuous",
      key: pick.key,
      contextKey: null,
      pick,
      speech: plannedSpeech,
      pageNumber: targetPageNumber,
      documentGeneration,
      controller,
      promise: null,
      result: null,
    };
    prefetch = slot;
    slot.promise = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted || runGeneration !== generation) throw abortError();
        return provider.synthesize({
          text: textForSpeech(pick.chunk, plannedSpeech),
          originalText: pick.chunk.text,
          language: pick.chunk.languageHint,
          chunk: pick.chunk,
          pageNumber: targetPageNumber,
          documentGeneration,
          speech: { ...plannedSpeech, prefetched: true },
          speed: plannedSpeech?.speed,
          signal: controller.signal,
        });
      })
      .then((result) => {
        if (controller.signal.aborted || runGeneration !== generation) throw abortError();
        prefetchCompleted += 1;
        if (prefetch === slot) slot.result = result;
        return result;
      })
      .catch((error) => {
        if (error?.name !== "AbortError") prefetchFailed += 1;
        if (prefetch === slot) prefetch = null;
        return null;
      });
  }

  function prepare({
    key,
    pick,
    pageNumber = 0,
    documentGeneration = 0,
    contextKey = null,
    speech = null,
  } = {}) {
    const preparedKey = String(key ?? pick?.key ?? "");
    if (!provider || !preparedKey || !pick?.chunk?.text?.trim()) {
      return { key: preparedKey || null, status: "missing", ready: false };
    }
    if (
      prefetch?.kind === "explicit" &&
      prefetch.key === preparedKey &&
      prefetch.contextKey === contextKey
    ) {
      return {
        key: preparedKey,
        status: prefetch.result ? "ready" : "reused",
        ready: Boolean(prefetch.result),
      };
    }
    abortPrefetch("prepared-target-changed");
    const controller = new AbortController();
    const runGeneration = generation;
    const slot = {
      kind: "explicit",
      key: preparedKey,
      contextKey,
      pick: { ...pick, key: preparedKey },
      speech,
      pageNumber,
      documentGeneration,
      controller,
      promise: null,
      result: null,
    };
    prefetchQueued += 1;
    status = "prepared-queued";
    slot.promise = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted || runGeneration !== generation) throw abortError();
        return provider.synthesize({
          text: trimTextForSpeech(pick.chunk.text, speech),
          originalText: pick.chunk.text,
          language: pick.chunk.languageHint,
          chunk: pick.chunk,
          pageNumber,
          documentGeneration,
          speech: { ...speech, prefetched: true },
          speed: speech?.speed,
          signal: controller.signal,
        });
      })
      .then((result) => {
        if (controller.signal.aborted || runGeneration !== generation) throw abortError();
        prefetchCompleted += 1;
        if (prefetch === slot) {
          slot.result = result;
          status = "prepared-ready";
        }
        return result;
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          prefetchFailed += 1;
          if (prefetch === slot) status = "prepared-failed";
        }
        if (prefetch === slot) prefetch = null;
        return null;
      });
    prefetch = slot;
    return { key: preparedKey, status: "queued", ready: false };
  }

  function playPrepared({
    key,
    contextKey = null,
  } = {}) {
    const requestedKey = String(key ?? "");
    const slot = prefetch;
    if (!slot || slot.kind !== "explicit" || slot.key !== requestedKey) {
      return { key: requestedKey || null, status: "missing", ready: false };
    }
    if (slot.contextKey !== contextKey) {
      abortPrefetch("prepared-stale");
      return { key: requestedKey, status: "stale", ready: false };
    }
    if (!slot.result) {
      abortPrefetch("prepared-late");
      return { key: requestedKey, status: "late", ready: false };
    }
    if (playbackLocked) {
      abortPrefetch("prepared-busy");
      return { key: requestedKey, status: "busy", ready: true };
    }

    prefetch = null;
    const pick = slot.pick;
    const result = slot.result;
    currentKey = requestedKey;
    lastPick = pick;
    lastSpeech = slot.speech;
    lastResult = result;
    playbackLocked = true;
    prefetchUsed += 1;
    completed += 1;
    status = result?.providerMeta?.skipped ? "simulated" : "completed";
    onPick?.({
      pick,
      pageNumber: slot.pageNumber,
      documentGeneration: slot.documentGeneration,
      speech: slot.speech,
    });
    onResult?.({
      result,
      pick,
      pageNumber: slot.pageNumber,
      documentGeneration: slot.documentGeneration,
    });
    return { ...pick, result, status: "played", ready: true };
  }

  function discardPrepared(reason = "prepared-discarded", options = {}) {
    return abortPrefetch(reason, options);
  }

  async function update({
    isPlaying = false,
    chunks = [],
    prefetchChunks = [],
    normalizedReadingY = 0.38,
    pageNumber = 0,
    documentGeneration = 0,
    speech = null,
  } = {}) {
    if (!isPlaying) {
      cancel("paused");
      playbackLocked = false;
      return null;
    }
    if (playbackLocked) {
      status = "holding-current-utterance";
      return lastPick;
    }

    const pick = pickReadableChunk(chunks, { normalizedReadingY, minPriority });
    lastPick = pick;
    if (!pick?.chunk) {
      status = "waiting-for-readable-chunk";
      currentKey = null;
      return null;
    }
    const activeSpeech = speechForChunk(speech, pick.chunk);
    if (activeSpeech?.utterancePlan?.decision === "skip") {
      return markSkipped(pick, activeSpeech, "visual-skip");
    }
    if (pick.key === currentKey && !speech?.manual) {
      status = "holding-current-chunk";
      return pick;
    }

    if (prefetch?.kind !== "explicit" && prefetch?.key === pick.key) {
      const prefetchedSignature = prefetchPlanSignature(
        prefetch.pick,
        prefetch.speech,
      );
      const activeSignature = prefetchPlanSignature(pick, activeSpeech);
      if (prefetchedSignature !== activeSignature) {
        abortPrefetch("prefetch-plan-changed");
      }
    }

    if (prefetch?.kind !== "explicit" && prefetch?.key === pick.key) {
      const awaitedPrefetch = prefetch;
      const prefetchGeneration = generation;
      playbackLocked = true;
      currentKey = pick.key;
      lastPick = pick;
      lastSpeech = activeSpeech;
      status = awaitedPrefetch.result ? "prefetch-hit" : "waiting-prefetch";
      if (speechIsLate(activeSpeech) || speechIsLate(awaitedPrefetch.speech)) {
        abortPrefetch("prefetch-late");
        return markSkipped(pick, activeSpeech, "late-skip");
      }
      onPick?.({ pick, pageNumber, documentGeneration, speech: activeSpeech });
      const result = awaitedPrefetch.result ?? await awaitedPrefetch.promise;
      if (
        prefetchGeneration !== generation ||
        awaitedPrefetch.controller.signal.aborted
      ) {
        if (prefetch === awaitedPrefetch) prefetch = null;
        playbackLocked = false;
        return null;
      }
      if (prefetch === awaitedPrefetch) prefetch = null;
      if (result) {
        if (speechIsLate(activeSpeech) || speechIsLate(awaitedPrefetch.speech)) {
          return markSkipped(pick, activeSpeech, "late-skip");
        }
        prefetchUsed += 1;
        completed += 1;
        lastResult = result;
        status = "completed";
        onResult?.({ result, pick, pageNumber, documentGeneration });
        startPrefetch({
          chunks: [...chunks, ...prefetchChunks],
          currentPick: pick,
          pageNumber,
          documentGeneration,
          speech: activeSpeech,
        });
        return { ...pick, result };
      }
      playbackLocked = false;
      status = "prefetch-miss";
    }

    cancel("switching-chunk");
    currentKey = pick.key;
    lastSpeech = activeSpeech;
    playbackLocked = true;
    queued += 1;
    status = "queued";
    onPick?.({ pick, pageNumber, documentGeneration, speech: activeSpeech });
    const runGeneration = generation;
    const controller = new AbortController();
    activeController = controller;
    let runResult = null;
    let runCancelled = false;

    try {
      const spokenText = textForSpeech(pick.chunk, activeSpeech);
      const result = await provider.synthesize({
        text: spokenText,
        originalText: pick.chunk.text,
        language: pick.chunk.languageHint,
        chunk: pick.chunk,
        pageNumber,
        documentGeneration,
        speech: activeSpeech,
        speed: activeSpeech?.speed,
        signal: controller.signal,
      });
      if (controller.signal.aborted || runGeneration !== generation) throw abortError();
      if (speechIsLate(activeSpeech)) {
        runResult = markSkipped(pick, activeSpeech, "late-skip");
        return runResult;
      }
      completed += 1;
      lastResult = result;
      runResult = result;
      status = result?.providerMeta?.skipped ? "simulated" : "completed";
      onResult?.({ result, pick, pageNumber, documentGeneration });
      startPrefetch({
        chunks: [...chunks, ...prefetchChunks],
        currentPick: pick,
        pageNumber,
        documentGeneration,
        speech: activeSpeech,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        runCancelled = true;
        playbackLocked = false;
        if (runGeneration === generation) status = "cancelled";
      } else {
        failed += 1;
        playbackLocked = false;
        status = "failed";
        lastResult = { error: error instanceof Error ? error.message : String(error) };
      }
    } finally {
      if (activeController === controller) activeController = null;
    }

    if (
      runCancelled ||
      controller.signal.aborted ||
      runGeneration !== generation
    ) return null;
    if (runResult?.skipped) return runResult;
    return runResult ? { ...pick, result: runResult } : null;
  }

  function reset(reason = "reset") {
    currentKey = null;
    lastPick = null;
    lastResult = null;
    lastSpeech = null;
    playbackLocked = false;
    cancel(reason);
  }

  function releasePlaybackLock(reason = "playback-ended") {
    playbackLocked = false;
    if (status === "holding-current-utterance" || status === "completed") status = reason;
  }

  function snapshot() {
    return {
      provider: provider
        ? { id: provider.id, name: provider.name, mode: provider.mode }
        : null,
      status,
      currentKey,
      queued,
      completed,
      cancelled,
      failed,
      active: Boolean(activeController),
      playbackLocked,
      prefetch: prefetch
        ? {
            kind: prefetch.kind ?? "continuous",
            key: prefetch.key,
            contextKey: prefetch.contextKey ?? null,
            ready: Boolean(prefetch.result),
            pick: previewPickedChunk(prefetch.pick),
          }
        : null,
      prefetchQueued,
      prefetchCompleted,
      prefetchUsed,
      prefetchFailed,
      lastPick: previewPickedChunk(lastPick),
      lastResult,
      lastSpeech,
    };
  }

  return {
    update,
    prepare,
    playPrepared,
    discardPrepared,
    cancel,
    reset,
    releasePlaybackLock,
    snapshot,
  };
}
