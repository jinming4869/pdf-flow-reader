# v4.0「希声」ReadableChunk 与 OCR 集成说明

> 状态说明（2026-07-25）：本文是实现前设计，其中“OCR 只返回纯文本”等描述已经过时。现状见 `IMPLEMENTATION_v4.0_HISHENG.md`；新的 native-first / OCR fallback 规则见根目录 `DECISIONS.md`。

更新时间：2026-07-24

## 结论

现有 OCR 功能可以直接帮助 v4.0 的 chunk 问题，但需要从“只为阅读速度估算提供文本”升级为“为 TTS 提供可定位文本结构”。

当前 OCR 管线：

```text
PDF page → canvas → Tesseract recognize → result.data.text → analyzeText()
```

v4.0 需要升级为：

```text
PDF page → native text / OCR text → TextSegment[] → ReadableChunk[] → TTS Scheduler
```

## 为什么 OCR 对 chunk 有帮助

TTS 的关键不只是有文本，而是知道：

- 这段文字在哪一页。
- 这段文字在页面的哪个 y 区间。
- 阅读线是否经过它。
- 它是正文、页眉、脚注、表格，还是噪声。

现有 OCR 已经能在扫描 PDF 或原生文本质量差时提供文本。若进一步保留 Tesseract 的 line / word bounding boxes，就可以生成带坐标的 `TextSegment`，从而补齐 scanned PDF 的随读能力。

## 当前限制

`ocr-provider.mjs` 目前只返回：

```js
result.data.text
```

这足够做阅读速度估算，但不够做 TTS 随读。因为纯文本没有坐标，无法判断阅读线附近该读哪一句。

## 建议升级

### 1. OCR provider 返回结构化结果

新增返回形态：

```js
{
  text,
  source: "ocr",
  pageNumber,
  words: [
    { text, bbox: { x, y, width, height }, confidence }
  ],
  lines: [
    { text, bbox, confidence }
  ]
}
```

兼容旧逻辑：

```js
const text = typeof result === "string" ? result : result?.text;
```

### 2. 统一 native 和 OCR 的 TextSegment

native textContent 转：

```text
PDF.js textContent.items → TextSegment[]
```

OCR 转：

```text
Tesseract lines/words → TextSegment[]
```

二者最终进入同一个：

```text
segmentsToReadableChunks(segments, pageLayout)
```

### 3. source 优先级

建议：

```text
native text 层质量好 → 用 native
native text 层碎裂/乱码/缺失 → 用 OCR
用户手动开启 OCR → OCR 可覆盖 native，用于扫描页或复杂页面
```

质量判断指标：

- 字符数是否过少。
- 是否存在大量孤立字符。
- 是否存在异常空格，如 `beganhisSystem` 或严重断裂。
- 是否有大比例不可见/异常符号。
- OCR confidence 是否可接受。

## Goertz PDF 暴露的问题

在 Gary Goertz《Social Science Concepts》PDF 上，native text 能提取正文，但会出现：

```text
October 20, 2005 14:31 nec100 Sheet number ...
CHAPTER ONE / INTRODUCTION running header
democ- racy
ﬁ / ﬂ ligature
beganhisSystem
Goertz’ s
```

这说明 v4.0 需要一个 `ReadableChunkCleaner`：

- 去页眉页脚。
- 修复 hyphenation。
- 修复 ligatures。
- 修复错误空格。
- 过滤脚注或降低脚注优先级。
- 表格/公式降权。

## OCR 与性能

OCR 不能默认全书扫描，否则 v4.0 会变重。建议沿用现有“附近页”策略：

```text
只处理当前页 ±N
用户开启 OCR 后才运行
优先当前页
跳页取消旧 OCR
OCR 结果进入短期缓存
```

TTS 使用 OCR 的策略：

```text
如果当前页 native chunks 可用：不触发 OCR
如果当前页 native chunks 不可用：提示用户开启扫描增强
如果用户已开启 OCR：用 OCR chunks 参与随读
```

## 模块建议

新增：

```text
readable-chunk.mjs
text-cleaner.mjs
ocr-segment-adapter.mjs
native-segment-adapter.mjs
```

数据流：

```text
native-segment-adapter / ocr-segment-adapter
→ TextSegment[]
→ text-cleaner
→ ReadableChunk[]
→ tts-segment-picker
→ tts-scheduler
```

## 验收点

- 原生英文 PDF 不读页眉页脚。
- Goertz 这种书稿 PDF 可生成 250-380 字符左右的自然 chunk。
- 扫描 PDF 开启 OCR 后也能生成带页面位置的 chunk。
- 跳页时 OCR 与 TTS 都可取消。
- OCR 关闭时不增加普通 PDF 的启动成本。
