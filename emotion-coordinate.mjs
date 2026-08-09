function clamp(value) {
  return Math.max(-1, Math.min(1, value));
}

function roundFact(value) {
  return Math.round(value * 1000) / 1000;
}

function finiteCoordinate(value) {
  const valence = Number(value?.valence);
  const arousal = Number(value?.arousal);
  if (!Number.isFinite(valence) || !Number.isFinite(arousal)) return null;
  return { valence, arousal };
}

export function normalizeEmotionCoordinate(value) {
  const coordinate = finiteCoordinate(value);
  if (!coordinate) return null;
  return {
    valence: roundFact(clamp(coordinate.valence)),
    arousal: roundFact(clamp(coordinate.arousal)),
  };
}

export function emotionFromPadPoint({ clientX, clientY, rectangle } = {}) {
  const width = Number(rectangle?.width);
  const height = Number(rectangle?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  const x = (Number(clientX) - Number(rectangle.left)) / width;
  const y = (Number(clientY) - Number(rectangle.top)) / height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return normalizeEmotionCoordinate({
    valence: x * 2 - 1,
    arousal: 1 - y * 2,
  });
}

export function moveEmotionCoordinate(value, key, { shiftKey = false } = {}) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return null;
  const base = normalizeEmotionCoordinate(value) ?? { valence: 0, arousal: 0 };
  const step = shiftKey ? 0.2 : 0.05;
  const delta = {
    ArrowLeft: { valence: -step, arousal: 0 },
    ArrowRight: { valence: step, arousal: 0 },
    ArrowUp: { valence: 0, arousal: step },
    ArrowDown: { valence: 0, arousal: -step },
  }[key];
  return normalizeEmotionCoordinate({
    valence: base.valence + delta.valence,
    arousal: base.arousal + delta.arousal,
  });
}

export function emotionMarkerPosition(value) {
  const coordinate = normalizeEmotionCoordinate(value);
  if (!coordinate) return null;
  return {
    leftPercent: roundFact((coordinate.valence + 1) * 50),
    topPercent: roundFact((1 - coordinate.arousal) * 50),
  };
}

export function nearbyEmotionWords(value) {
  const coordinate = normalizeEmotionCoordinate(value);
  if (!coordinate) return [];
  const { valence, arousal } = coordinate;
  if (Math.abs(valence) < 0.15 && Math.abs(arousal) < 0.15) {
    return ["难以命名", "复杂", "平静"];
  }
  if (valence >= 0 && arousal >= 0) return ["振奋", "惊喜", "兴奋"];
  if (valence < 0 && arousal >= 0) return ["不安", "愤怒", "紧张"];
  if (valence >= 0 && arousal < 0) return ["安宁", "满足", "舒缓"];
  return ["低落", "疲惫", "疏离"];
}
