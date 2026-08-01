import { splitSentences } from "./tts-sentence.mjs";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function chunkKey(chunk) {
  if (!chunk) return null;
  if (chunk.speechKey) return String(chunk.speechKey);
  return `${chunk.source ?? "unknown"}:${chunk.pageIndex ?? 0}:${chunk.chunkIndex ?? 0}`;
}

export function isReadableChunk(chunk, { minPriority = 0.5 } = {}) {
  if (!chunk || typeof chunk.text !== "string" || !chunk.text.trim()) return false;
  if (!chunk.normalizedBbox) return false;
  if (finiteNumber(chunk.priority, 0) < minPriority) return false;
  return !["table", "formula", "reference"].includes(chunk.role);
}

export function distanceToReadingLine(chunk, normalizedReadingY = 0) {
  const box = chunk?.normalizedBbox;
  if (!box) return Number.POSITIVE_INFINITY;
  const start = finiteNumber(box.y);
  const end = start + finiteNumber(box.height);
  if (normalizedReadingY >= start && normalizedReadingY <= end) return 0;
  return Math.min(Math.abs(normalizedReadingY - start), Math.abs(normalizedReadingY - end));
}

export function pickReadableChunk(chunks = [], {
  normalizedReadingY = 0.38,
  minPriority = 0.5,
  lookBehind = 0.045,
  lookAhead = 0.16,
  excludeKeys = new Set(),
} = {}) {
  const y = Math.max(0, Math.min(1, finiteNumber(normalizedReadingY, 0.38)));
  const candidates = chunks
    .filter((chunk) => isReadableChunk(chunk, { minPriority }))
    .filter((chunk) => !excludeKeys.has(chunkKey(chunk)))
    .map((chunk) => {
      const box = chunk.normalizedBbox;
      const start = finiteNumber(box.y);
      const end = start + finiteNumber(box.height);
      const center = start + finiteNumber(box.height) / 2;
      const inWindow = end >= y - lookBehind && start <= y + lookAhead;
      const distance = distanceToReadingLine(chunk, y);
      const aheadPenalty = center < y - lookBehind ? 0.2 : 0;
      const priorityBonus = (1 - finiteNumber(chunk.priority, 0)) * 0.08;
      return {
        chunk,
        key: chunkKey(chunk),
        inWindow,
        score: distance + aheadPenalty + priorityBonus,
        center,
      };
    })
    .filter((entry) => entry.inWindow);

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score || a.center - b.center);
  const best = candidates[0];
  return {
    chunk: best.chunk,
    key: best.key,
    normalizedReadingY: y,
    distance: distanceToReadingLine(best.chunk, y),
  };
}

export function pickReadableSentenceBelowLine(chunks = [], {
  normalizedReadingY = 0.38,
  minPriority = 0.5,
} = {}) {
  const readingY = Math.max(
    0,
    Math.min(1, finiteNumber(normalizedReadingY, 0.38)),
  );
  const candidates = [];

  for (const chunk of chunks.filter((entry) => isReadableChunk(entry, { minPriority }))) {
    const box = chunk.normalizedBbox;
    const sentences = splitSentences(chunk.text);
    const totalLength = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
    if (!sentences.length || totalLength <= 0) continue;

    let characterOffset = 0;
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
      const sentence = sentences[sentenceIndex];
      const startRatio = characterOffset / totalLength;
      const endRatio = (characterOffset + sentence.length) / totalLength;
      characterOffset += sentence.length;
      const y = finiteNumber(box.y) + finiteNumber(box.height) * startRatio;
      const height = Math.max(
        0.008,
        finiteNumber(box.height) * Math.max(0.01, endRatio - startRatio),
      );
      const center = y + height / 2;
      if (y < readingY) continue;

      const key = `${chunkKey(chunk)}:sentence:${sentenceIndex}`;
      candidates.push({
        key,
        sentenceIndex,
        distance: y - readingY,
        chunk: {
          ...chunk,
          text: sentence,
          speechKey: key,
          sentenceIndex,
          normalizedBbox: {
            ...box,
            y,
            height,
          },
        },
        normalizedReadingY: readingY,
      });
    }
  }

  candidates.sort((a, b) => (
    a.distance - b.distance ||
    finiteNumber(a.chunk.normalizedBbox?.y) - finiteNumber(b.chunk.normalizedBbox?.y)
  ));
  return candidates[0] ?? null;
}

export function previewPickedChunk(pick) {
  if (!pick?.chunk) return null;
  const { chunk } = pick;
  const text = typeof chunk.text === "string" ? chunk.text : "";
  return {
    key: pick.key,
    pageIndex: chunk.pageIndex,
    chunkIndex: chunk.chunkIndex,
    source: chunk.source,
    role: chunk.role,
    priority: chunk.priority,
    normalizedReadingY: pick.normalizedReadingY,
    normalizedYStart: chunk.normalizedBbox?.y ?? null,
    normalizedYEnd: chunk.normalizedBbox
      ? chunk.normalizedBbox.y + chunk.normalizedBbox.height
      : null,
    text: text.length > 180 ? `${text.slice(0, 177)}…` : text,
  };
}
