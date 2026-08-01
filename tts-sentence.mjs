// tts-sentence.mjs — deterministic sentence boundaries for local PDF speech

const CJK_SENTENCE_ENDINGS = new Set(["。", "！", "？", "；"]);
const LATIN_SENTENCE_ENDINGS = new Set([".", "!", "?", ";"]);
const SENTENCE_CLOSERS = new Set([
  '"',
  "'",
  "”",
  "’",
  "」",
  "』",
  "》",
  "）",
  "】",
  ")",
  "]",
]);
const COMMON_PERIOD_ABBREVIATIONS = new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "sr",
  "jr",
  "st",
  "vs",
  "etc",
  "no",
  "fig",
]);
const COMMON_SENTENCE_STARTERS = new Set([
  "a",
  "an",
  "another",
  "but",
  "however",
  "it",
  "next",
  "she",
  "that",
  "the",
  "they",
  "this",
  "we",
  "yet",
]);
const SINGLE_LETTER_LABEL_PREFIXES = new Set([
  "appendix",
  "case",
  "category",
  "chapter",
  "class",
  "condition",
  "equation",
  "experiment",
  "fig",
  "figure",
  "grade",
  "group",
  "item",
  "model",
  "option",
  "panel",
  "part",
  "phase",
  "plan",
  "sample",
  "section",
  "step",
  "table",
  "theory",
  "type",
  "version",
  "volume",
]);

function normalizeSpeechText(text = "") {
  return String(text).replace(/\s+/gu, " ").trim();
}

function isDecimalPoint(text, index) {
  return (
    text[index] === "." &&
    /\p{Nd}/u.test(text[index - 1] ?? "") &&
    /\p{Nd}/u.test(text[index + 1] ?? "")
  );
}

function isAbbreviationPeriod(text, index) {
  if (text[index] !== ".") return false;
  const token = text.slice(0, index).match(/[\p{L}.]+$/u)?.[0] ?? "";
  const normalized = token.toLocaleLowerCase("en");
  if (COMMON_PERIOD_ABBREVIATIONS.has(normalized)) return true;
  if (/^\p{L}$/u.test(token)) {
    const nextWord = text.slice(index + 1).match(/^\s+(\p{Lu}[\p{L}'’\-]*)/u)?.[1] ?? "";
    if (!nextWord || COMMON_SENTENCE_STARTERS.has(nextWord.toLocaleLowerCase("en"))) {
      return false;
    }
    if (/^\p{Lu}$/u.test(nextWord)) return true;
    const beforeInitial = text.slice(0, index - token.length).trimEnd();
    const previousName = beforeInitial.match(/([\p{Lu}][\p{Ll}'’\-]+)$/u)?.[1] ?? "";
    const previousInitial = /(?:^|\s)\p{Lu}\.$/u.test(beforeInitial);
    return Boolean(
      previousInitial ||
      (
        previousName &&
        !SINGLE_LETTER_LABEL_PREFIXES.has(previousName.toLocaleLowerCase("en"))
      )
    );
  }
  return /^(?:\p{L}\.)+\p{L}$/u.test(token);
}

function sentenceEndWithClosers(text, punctuationIndex) {
  let end = punctuationIndex + 1;
  while (SENTENCE_CLOSERS.has(text[end])) end += 1;
  return end;
}

export function splitSentenceRanges(text = "") {
  const source = String(text);
  const ranges = [];
  let start = 0;

  while (start < source.length) {
    while (start < source.length && /\s/u.test(source[start])) start += 1;
    if (start >= source.length) break;

    let boundary = null;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (
        !CJK_SENTENCE_ENDINGS.has(character) &&
        !LATIN_SENTENCE_ENDINGS.has(character)
      ) {
        continue;
      }
      if (isDecimalPoint(source, index) || isAbbreviationPeriod(source, index)) {
        continue;
      }

      const end = sentenceEndWithClosers(source, index);
      if (
        CJK_SENTENCE_ENDINGS.has(character) ||
        source[end] === undefined ||
        /\s/u.test(source[end])
      ) {
        boundary = end;
        break;
      }
    }

    const end = boundary ?? source.length;
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/u.test(source[trimmedEnd - 1])) trimmedEnd -= 1;
    const sentence = normalizeSpeechText(source.slice(start, trimmedEnd));
    if (sentence) {
      ranges.push({
        text: sentence,
        start,
        end: trimmedEnd,
        complete: boundary !== null,
      });
    }
    if (boundary === null) break;
    start = boundary;
  }

  return ranges;
}

export function firstSentence(text = "") {
  return splitSentenceRanges(text)[0]?.text ?? "";
}

export function splitSentences(text = "") {
  return splitSentenceRanges(text).map((range) => range.text);
}

export function stripBalancedParentheticals(text = "") {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return "";

  const openingToClosing = new Map([
    ["(", ")"],
    ["（", "）"],
  ]);
  const closingCharacters = new Set(openingToClosing.values());
  const characters = Array.from(normalized);
  const stack = [];
  const remove = new Set();

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (openingToClosing.has(character)) {
      stack.push({
        expected: openingToClosing.get(character),
        index,
      });
    } else if (closingCharacters.has(character)) {
      const opening = stack.at(-1);
      if (opening?.expected !== character) continue;
      stack.pop();
      for (let offset = opening.index; offset <= index; offset += 1) {
        remove.add(offset);
      }
    }
  }
  return normalizeSpeechText(
    characters.filter((_, index) => !remove.has(index)).join(""),
  );
}
