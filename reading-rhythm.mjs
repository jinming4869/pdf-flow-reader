export function rateRange(value, spread = 0.12) {
  const rate = Math.max(0, Math.round(Number(value) || 0));
  if (!rate) return { min: 0, max: 0 };
  const safeSpread = Math.max(0, Math.min(0.5, Number(spread) || 0));
  return {
    min: Math.max(1, Math.round(rate * (1 - safeSpread))),
    max: Math.max(1, Math.round(rate * (1 + safeSpread))),
  };
}

export function densityLevelFromRatio(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) {
    return { key: "unknown", label: "密度待估", hint: "这一带的文字密度还在形成回声。" };
  }
  if (value < 0.72) {
    return { key: "sparse", label: "偏疏", hint: "这一页留白较多，纸页会显得轻一些。" };
  }
  if (value > 1.42) {
    return { key: "dense", label: "偏密", hint: "这一页文字偏稠，适合让速度慢一点。" };
  }
  if (value > 1.16) {
    return { key: "slightly-dense", label: "略密", hint: "这一页比附近纸页略密。" };
  }
  if (value < 0.86) {
    return { key: "slightly-sparse", label: "略疏", hint: "这一页比附近纸页略疏。" };
  }
  return { key: "balanced", label: "平衡", hint: "这一带的文字密度比较平稳。" };
}

export function flowTimeRange(remainingPixels, pixelsPerSecond, spread = 0.1) {
  const pixels = Math.max(0, Number(remainingPixels) || 0);
  const speed = Math.max(0, Number(pixelsPerSecond) || 0);
  if (!pixels || !speed) return null;
  const minutes = pixels / speed / 60;
  const safeSpread = Math.max(0, Math.min(0.5, Number(spread) || 0));
  return {
    minMinutes: Math.max(1, Math.round(minutes * (1 - safeSpread))),
    maxMinutes: Math.max(1, Math.round(minutes * (1 + safeSpread))),
  };
}

export function createRhythmSnapshot({
  mode = "empty",
  cjkRate = 0,
  englishRate = 0,
  densityRatio = null,
  remainingPixels = 0,
  pixelsPerSecond = 0,
  tier = null,
  source = "native-text",
} = {}) {
  const cjkRange = rateRange(cjkRate);
  const englishRange = rateRange(englishRate);
  const density = densityLevelFromRatio(densityRatio);
  return {
    mode,
    tier,
    pixelsPerSecond,
    source,
    cjkRate,
    englishRate,
    cjkRange,
    englishRange,
    densityRatio,
    density,
    remainingFlowTime: flowTimeRange(remainingPixels, pixelsPerSecond),
  };
}
