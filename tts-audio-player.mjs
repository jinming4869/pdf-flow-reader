// tts-audio-player.mjs — 希声 Web Audio 播放层（PRD §6.4）

function clamp01(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function nowFromContext(context) {
  return Number.isFinite(context?.currentTime) ? context.currentTime : 0;
}

export function createTtsAudioPlayer({
  audioContextFactory,
  volume = 0.42,
  muted = true,
  fadeMs = 80,
  onStateChange,
} = {}) {
  let context = null;
  let gainNode = null;
  let activeSource = null;
  let activeStartedAt = 0;
  let activeDuration = 0;
  let generation = 0;
  let status = "idle";
  let played = 0;
  let stopped = 0;
  let failed = 0;
  let lastError = null;
  let currentVolume = clamp01(volume, 0.42);
  let isMuted = Boolean(muted);

  function emit(extra = {}) {
    onStateChange?.(snapshot(extra));
  }

  function getContext() {
    if (context) return context;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    context = audioContextFactory ? audioContextFactory() : new Ctor();
    gainNode = context.createGain();
    gainNode.gain.value = isMuted ? 0 : currentVolume;
    gainNode.connect(context.destination);
    return context;
  }

  function setGainTarget(value, durationMs = fadeMs) {
    if (!gainNode) return;
    const target = clamp01(value, 0);
    const t = nowFromContext(context);
    gainNode.gain.cancelScheduledValues?.(t);
    gainNode.gain.setValueAtTime?.(gainNode.gain.value ?? target, t);
    if (durationMs > 0 && gainNode.gain.linearRampToValueAtTime) {
      gainNode.gain.linearRampToValueAtTime(target, t + durationMs / 1000);
    } else {
      gainNode.gain.value = target;
    }
  }

  async function decode(audioBuffer) {
    const ctx = getContext();
    const copy = audioBuffer instanceof ArrayBuffer
      ? audioBuffer.slice(0)
      : audioBuffer?.buffer?.slice(audioBuffer.byteOffset ?? 0, (audioBuffer.byteOffset ?? 0) + audioBuffer.byteLength);
    if (!copy) throw new Error("没有可播放的音频数据");
    return await ctx.decodeAudioData(copy);
  }

  async function play({ audioBuffer, providerMeta } = {}) {
    if (!audioBuffer) {
      status = "skipped";
      emit({ providerMeta });
      return null;
    }
    stop({ reason: "replace", fade: false });
    const playGeneration = ++generation;

    try {
      const ctx = getContext();
      await ctx.resume?.();
      const decoded = await decode(audioBuffer);
      if (playGeneration !== generation) return null;
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(gainNode);
      activeSource = source;
      activeStartedAt = nowFromContext(ctx);
      activeDuration = decoded.duration ?? 0;
      status = "playing";
      played += 1;
      setGainTarget(isMuted ? 0 : currentVolume, fadeMs);
      source.onended = () => {
        if (activeSource === source) {
          activeSource = null;
          status = "idle";
          emit({ ended: true });
        }
      };
      source.start(0);
      emit({ providerMeta });
      return source;
    } catch (e) {
      if (playGeneration !== generation) return null;
      failed += 1;
      status = "failed";
      lastError = e instanceof Error ? e.message : String(e);
      emit({ error: lastError });
      return null;
    }
  }

  function stop({ reason = "stop", fade = true } = {}) {
    generation += 1;
    if (!activeSource) {
      status = status === "playing" ? "idle" : status;
      return;
    }
    const source = activeSource;
    activeSource = null;
    stopped += 1;
    status = reason;
    const stopNow = () => {
      try { source.stop(0); } catch {}
      try { source.disconnect?.(); } catch {}
      emit({ reason });
    };
    if (fade && fadeMs > 0) {
      setGainTarget(0, fadeMs);
      globalThis.setTimeout?.(stopNow, fadeMs);
    } else {
      stopNow();
    }
  }

  function setMuted(next) {
    isMuted = Boolean(next);
    setGainTarget(isMuted ? 0 : currentVolume, fadeMs);
    emit({ muted: isMuted });
  }

  function setVolume(next) {
    currentVolume = clamp01(next, currentVolume);
    if (!isMuted) setGainTarget(currentVolume, fadeMs);
    emit({ volume: currentVolume });
  }

  function duck(factor = 0.45) {
    if (isMuted) return;
    setGainTarget(currentVolume * clamp01(factor, 0.45), fadeMs);
  }

  function unduck() {
    if (isMuted) return;
    setGainTarget(currentVolume, fadeMs);
  }

  function snapshot(extra = {}) {
    return {
      status,
      muted: isMuted,
      volume: currentVolume,
      active: Boolean(activeSource),
      played,
      stopped,
      failed,
      error: lastError,
      activeStartedAt,
      activeDuration,
      ...extra,
    };
  }

  return {
    play,
    stop,
    setMuted,
    setVolume,
    duck,
    unduck,
    snapshot,
  };
}
