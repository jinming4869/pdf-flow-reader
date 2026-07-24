export const SPEED_TIERS = Object.freeze([
  { max: 8, name: "雪国朦胧", themeKey: "snow-mist" },
  { max: 14, name: "美学散步", themeKey: "aesthetic-walk" },
  { max: 21, name: "长日留痕", themeKey: "long-day" },
  { max: 31, name: "流觞曲水", themeKey: "winding-stream" },
  { max: 44, name: "强风吹拂", themeKey: "strong-wind" },
  { max: 64, name: "万物繁盛", themeKey: "all-things-flourish" },
]);

const MIXED_LANGUAGE_RATIO = 0.15;
const MIXED_LANGUAGE_MINIMUM = 20;

export function speedTier(value) {
  return SPEED_TIERS.find((tier) => value <= tier.max) ?? SPEED_TIERS.at(-1);
}

export function analyzeText(text, source = "native") {
  const cjkCharacters =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)
      ?.length ?? 0;
  const numericUnits = text.match(/\p{Nd}/gu)?.length ?? 0;
  const englishWords =
    text.match(/\p{Script=Latin}+(?:['’\-]\p{Script=Latin}+)*/gu)?.length ?? 0;

  return { cjkCharacters, numericUnits, englishWords, source };
}

export function readingMetricMode(cjkCharacters, englishWords) {
  const totalUnits = cjkCharacters + englishWords;
  if (!totalUnits) return "empty";

  const showBoth =
    cjkCharacters >= MIXED_LANGUAGE_MINIMUM &&
    englishWords >= MIXED_LANGUAGE_MINIMUM &&
    cjkCharacters / totalUnits >= MIXED_LANGUAGE_RATIO &&
    englishWords / totalUnits >= MIXED_LANGUAGE_RATIO;

  if (showBoth) return "both";
  return cjkCharacters >= englishWords ? "cjk" : "english";
}

export function unitsPerMinute(units, measuredHeight, pixelsPerSecond) {
  if (units <= 0 || measuredHeight <= 0 || pixelsPerSecond <= 0) return 0;
  return Math.round((units / measuredHeight) * pixelsPerSecond * 60);
}
