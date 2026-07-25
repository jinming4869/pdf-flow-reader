const DEFAULT_VOLUME = 0.28;
const CUE_DEBOUNCE_MS = 260;

const TIER_PITCHES = Object.freeze([196, 220, 262, 330, 392, 523]);

export function clampVolume(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, parsed));
}

export function cueDirection(fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return "same";
  if (toIndex > fromIndex) return "up";
  if (toIndex < fromIndex) return "down";
  return "same";
}

export function transitionSteps(fromIndex, toIndex) {
  const direction = cueDirection(fromIndex, toIndex);
  if (direction === "same") return [];
  const start = Math.max(0, Math.min(TIER_PITCHES.length - 1, fromIndex));
  const end = Math.max(0, Math.min(TIER_PITCHES.length - 1, toIndex));
  const step = direction === "up" ? 1 : -1;
  const result = [];
  for (let index = start; index !== end; index += step) {
    result.push({
      direction,
      fromIndex: index,
      toIndex: index + step,
      boundaryIndex: direction === "up" ? index : index - 1,
    });
  }
  return result;
}

export function createCueNotes(fromIndex, toIndex) {
  const steps = transitionSteps(fromIndex, toIndex);
  if (!steps.length) return [];

  const notes = [Math.max(0, Math.min(TIER_PITCHES.length - 1, fromIndex))];
  for (const step of steps) notes.push(step.toIndex);

  return notes.map((tierIndex, index) => ({
    frequency: TIER_PITCHES[tierIndex],
    offsetMs: index * 92,
    durationMs: 220,
  }));
}

function audioContextCtor() {
  return globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
}

function setSynthEnvelope(gainNode, start, stop, peak) {
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + 0.035);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, stop);
}

function playSynthNotes(audioContext, notes, volume, startAt = audioContext.currentTime) {
  let endTime = startAt;
  for (const note of notes) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = startAt + note.offsetMs / 1000;
    const stop = start + note.durationMs / 1000;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequency, start);
    setSynthEnvelope(gain, start, stop, volume * 0.18);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(stop + 0.02);
    endTime = Math.max(endTime, stop + 0.02);
  }
  return endTime;
}

function audioBufferDurationMs(buffer) {
  return Math.max(120, Math.round((buffer?.duration ?? 0.18) * 1000));
}

export function cueSampleName(step) {
  if (!step || !["up", "down"].includes(step.direction)) return null;
  return `${step.direction}-${step.boundaryIndex + 1}`;
}

export function createSpeedCueEngine({
  getVolume = () => DEFAULT_VOLUME,
  getPatternMode = () => "soft",
  getSampleUrl = () => null,
  debounceMs = CUE_DEBOUNCE_MS,
} = {}) {
  let context = null;
  let timer = 0;
  let pending = null;
  let playbackEndTime = 0;
  const sampleCache = new Map();

  function ensureContext() {
    if (context) return context;
    const AudioContextClass = audioContextCtor();
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    return context;
  }

  async function resume() {
    const audioContext = ensureContext();
    if (!audioContext) return false;
    if (audioContext.state === "suspended") await audioContext.resume();
    return audioContext.state === "running";
  }

  async function loadSample(url) {
    if (!url || typeof fetch !== "function") return null;
    if (sampleCache.has(url)) return sampleCache.get(url);
    const promise = fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => (buffer ? ensureContext()?.decodeAudioData(buffer) : null))
      .catch(() => null);
    sampleCache.set(url, promise);
    return promise;
  }

  function playBuffer(buffer, start, volume) {
    const audioContext = ensureContext();
    if (!audioContext || !buffer) return start;
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const stop = start + buffer.duration;
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume * 0.72), start + 0.025);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume * 0.72), Math.max(start + 0.03, stop - 0.055));
    gain.gain.linearRampToValueAtTime(0.0001, stop);
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start(start);
    return stop;
  }

  async function playSampleSteps(steps, volume) {
    const audioContext = ensureContext();
    if (!audioContext || audioContext.state !== "running") return false;
    const buffers = [];
    for (const step of steps) {
      const url = getSampleUrl(step);
      const buffer = await loadSample(url);
      if (!buffer) return false;
      buffers.push(buffer);
    }

    let start = Math.max(audioContext.currentTime, playbackEndTime + 0.04);
    for (const buffer of buffers) {
      const stop = playBuffer(buffer, start, volume);
      start = stop + 0.045;
    }
    playbackEndTime = Math.max(playbackEndTime, start);
    return true;
  }

  function playSynthTransition(fromIndex, toIndex, volume) {
    const audioContext = ensureContext();
    if (!audioContext || audioContext.state !== "running") return;
    const notes = createCueNotes(fromIndex, toIndex);
    if (!notes.length) return;
    const start = Math.max(audioContext.currentTime, playbackEndTime + 0.04);
    playbackEndTime = playSynthNotes(audioContext, notes, volume, start);
  }

  async function playTransition(fromIndex, toIndex) {
    const audioContext = ensureContext();
    if (!audioContext || audioContext.state !== "running") return;
    const volume = clampVolume(getVolume());
    const steps = transitionSteps(fromIndex, toIndex);
    if (!steps.length) return;

    if (getPatternMode() === "clear") {
      const played = await playSampleSteps(steps, volume);
      if (played) return;
    }
    playSynthTransition(fromIndex, toIndex, volume);
  }

  function queueTierChange(fromIndex, toIndex) {
    if (cueDirection(fromIndex, toIndex) === "same") return;
    if (pending) {
      pending.toIndex = toIndex;
    } else {
      pending = { fromIndex, toIndex };
    }
    globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => {
      timer = 0;
      const next = pending;
      pending = null;
      if (next && cueDirection(next.fromIndex, next.toIndex) !== "same") {
        void playTransition(next.fromIndex, next.toIndex);
      }
    }, debounceMs);
  }

  function cancel() {
    globalThis.clearTimeout(timer);
    timer = 0;
    pending = null;
    playbackEndTime = 0;
  }

  return {
    resume,
    queueTierChange,
    cancel,
    get running() {
      return context?.state === "running";
    },
  };
}
