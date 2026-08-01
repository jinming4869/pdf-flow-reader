import test from "node:test";
import assert from "node:assert/strict";

import {
  ocrLanguageSetForDocumentLabel,
  ocrLanguageSetForText,
  ocrRenderScaleForWidth,
} from "../ocr-provider.mjs";

test("OCR language routing removes unrelated models after script detection", () => {
  assert.equal(
    ocrLanguageSetForText("土地合并以后，农民仍然依靠公共土地维持生活。"),
    "chi_sim+eng",
  );
  assert.equal(
    ocrLanguageSetForText("このあたりは学生の町です。図書館へ行きます。"),
    "jpn+chi_sim+eng",
  );
  assert.equal(
    ocrLanguageSetForText("這本書討論閱讀與傳統社會的關係。"),
    "chi_tra+eng",
  );
  assert.equal(
    ocrLanguageSetForText("This scanned journal page contains enough English prose for routing."),
    "eng",
  );
});

test("OCR document labels can lock an unambiguous Japanese or English model", () => {
  assert.equal(
    ocrLanguageSetForDocumentLabel("新编日语 第1册 清晰扫描.pdf"),
    "jpn+chi_sim+eng",
  );
  assert.equal(
    ocrLanguageSetForDocumentLabel("みんなの日本語.pdf"),
    "jpn+chi_sim+eng",
  );
  assert.equal(
    ocrLanguageSetForDocumentLabel("Political Theory Reader.pdf"),
    "eng",
  );
  assert.equal(
    ocrLanguageSetForDocumentLabel("专制与民主的社会起源.pdf"),
    null,
  );
});

test("OCR renders narrow scanned books at a higher but bounded scale", () => {
  assert.equal(ocrRenderScaleForWidth(396.85), 3.2);
  assert.ok(ocrRenderScaleForWidth(612) > 2.6);
  assert.equal(ocrRenderScaleForWidth(2_000), 1.5);
  assert.equal(ocrRenderScaleForWidth(0), 1.5);
});
