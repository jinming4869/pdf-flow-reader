import test from "node:test";
import assert from "node:assert/strict";

import {
  firstSentence,
  splitSentences,
  stripBalancedParentheticals,
} from "../tts-sentence.mjs";

test("firstSentence splits short Chinese text without requiring whitespace", () => {
  assert.equal(firstSentence("好。下一句。"), "好。");
  assert.equal(firstSentence("第一句。第二句。"), "第一句。");
});

test("firstSentence splits ordinary Japanese text without whitespace", () => {
  assert.equal(
    firstSentence("最初の文です。次の文です。"),
    "最初の文です。",
  );
});

test("firstSentence keeps sentence-closing punctuation with the first sentence", () => {
  assert.equal(firstSentence("他说：“好。”然后离开。"), "他说：“好。”");
  assert.equal(firstSentence("「読みます。」次へ。"), "「読みます。」");
});

test("firstSentence preserves English behavior and does not split decimals", () => {
  assert.equal(
    firstSentence("This is the first sentence. This is the second."),
    "This is the first sentence.",
  );
  assert.equal(firstSentence("The value is 3.14. Next value."), "The value is 3.14.");
  assert.equal(
    firstSentence("Dr. Smith arrived. Next sentence."),
    "Dr. Smith arrived.",
  );
  assert.equal(
    firstSentence("Mr. Jones stayed. Next sentence."),
    "Mr. Jones stayed.",
  );
  assert.equal(
    firstSentence("U.S. policy changed. Next sentence."),
    "U.S. policy changed.",
  );
  assert.equal(
    firstSentence("Use examples, e.g. a short phrase. Next sentence."),
    "Use examples, e.g. a short phrase.",
  );
});

test("firstSentence does not split a person's single-letter initials", () => {
  assert.equal(
    firstSentence("Peter A. Hall wrote this sentence. Another follows."),
    "Peter A. Hall wrote this sentence.",
  );
  assert.equal(
    firstSentence("J. K. Rowling wrote this sentence. Another follows."),
    "J. K. Rowling wrote this sentence.",
  );
});

test("single-letter labels at a real sentence ending remain boundaries", () => {
  for (const [source, expected] of [
    ["Plan A. Next sentence.", ["Plan A.", "Next sentence."]],
    ["Section B. Another paragraph.", ["Section B.", "Another paragraph."]],
    ["Appendix A. Results follow.", ["Appendix A.", "Results follow."]],
    ["Section B. Results follow.", ["Section B.", "Results follow."]],
    ["Figure A. Results follow.", ["Figure A.", "Results follow."]],
    ["Option C. Results follow.", ["Option C.", "Results follow."]],
  ]) {
    assert.deepEqual(splitSentences(source), expected);
  }
});

test("firstSentence returns normalized full text when no sentence ending exists", () => {
  assert.equal(firstSentence("  一段   没有句号的文字  "), "一段 没有句号的文字");
});

test("splitSentences keeps ordered CJK and English sentence units", () => {
  assert.deepEqual(
    splitSentences("第一句。第二句。 Dr. Smith arrived. Final sentence."),
    ["第一句。", "第二句。", "Dr. Smith arrived.", "Final sentence."],
  );
});

test("stripBalancedParentheticals removes only complete ASCII and CJK pairs", () => {
  assert.equal(
    stripBalancedParentheticals("正文（旁注）继续 (note) 收束。"),
    "正文继续 收束。",
  );
  assert.equal(
    stripBalancedParentheticals("正文（未完成的旁注"),
    "正文（未完成的旁注",
  );
  assert.equal(
    stripBalancedParentheticals("Text (unfinished note"),
    "Text (unfinished note",
  );
  assert.equal(
    stripBalancedParentheticals("正文（旁注）继续（未完成"),
    "正文继续（未完成",
  );
});
