# 夜晚的书斋 v4.0「希声」执行记录

> 状态说明（2026-07-25）：本文是 ReadableChunk、native text 和 OCR 结构化阶段的早期日志。后续 TTS 原型状态见 `ENGINEERING_LOG_v4.0_HISHENG_PHASE1.md`，当前计划见根目录 `PLAN.md`。

## 2026-07-24：P0 ReadableChunk 地基

本轮先实现 TTS 之前的文本结构层，不接 TTS 模型，不改 UI。

### 新增模块

- `text-cleaner.mjs`
  - 修复 PDF ligature：`ﬁ`、`ﬂ` 等。
  - 修复断词：如 `democ- racy` → `democracy`。
  - 修复所有格空格：如 `Goertz’ s` → `Goertz’s`。
  - 过滤 Goertz 类 PDF 生产页眉：`October 20, 2005 ... Sheet number ... Page number ...`。
  - 识别页码、装饰符、重复 running header。

- `readable-chunk.mjs`
  - 将 `TextSegment[]` 聚合为行。
  - 基础双栏排序：左栏从上到下，再右栏从上到下。
  - 过滤 running header / page number。
  - 合并为适合 TTS 的 `ReadableChunk[]`。
  - 为 chunk 附带 `bbox`、`yStart/yEnd`、`languageHint`、`role`、`priority`。

### 新增测试

- `tests/text-cleaner.test.mjs`
- `tests/readable-chunk.test.mjs`

覆盖：

- ligature 修复。
- Goertz 类页眉过滤。
- 断词修复。
- running header 识别。
- TextSegment 聚合为行。
- 英文 TTS chunk 合并。
- 基础双栏阅读顺序。

### 打包与静态服务

已将以下文件加入 Electron 打包清单与本地静态路由：

- `text-cleaner.mjs`
- `readable-chunk.mjs`

## 2026-07-25：P0 Native textContent diagnostics

本轮将 `ReadableChunk` 接入真实 PDF.js native textContent 链路，但仍然不触发 TTS、不改阅读 UI。

### 接入点

- `app.mjs` 现在在 `extractPageTextStats()` 中同时完成：
  - PDF.js `page.getTextContent()` → 阅读速度 stats。
  - PDF.js `textContent.items` → `TextSegment[]`。
  - `TextSegment[]` → `ReadableChunk[]`。
- 新增 `pageReadableChunkCache`，按页缓存 native chunks。
- 当前页附近文本 stats 刷新时，同步刷新 chunk diagnostics。

### Diagnostics

`window.__pdfFlowDiagnostics.snapshot()` 现在会包含：

```js
readableChunks: {
  source: "native-text",
  cachedPages,
  currentPage,
  nearby: [
    {
      pageNumber,
      ready,
      count,
      preview: [
        { chunkIndex, role, languageHint, yStart, yEnd, text }
      ]
    }
  ]
}
```

为了避免 diagnostics 过重，每页只展示前 5 个 chunk，单条文本会截断到 160 字符以内。

### 静态路由测试

- `tests/server-range.test.mjs` 已覆盖 `/readable-chunk.mjs` 静态资源 HEAD 请求。

## 2026-07-25：P0 OCR segment adapter

本轮将现有 OCR 管线从“只返回纯文本”升级为“返回文本 + words/lines bbox”，并接入 `ReadableChunk` 缓存。仍然不触发 TTS、不改阅读 UI。

### 新增模块

- `ocr-segment-adapter.mjs`
  - `normalizeOcrResult()`：兼容原始 Tesseract `result.data` 与 provider 包装后的结构。
  - `bboxFromOcrBox()`：兼容 `x0/y0/x1/y1` 与 `left/top/width/height` 两类 bbox。
  - `segmentsFromOcrResult()`：优先使用 OCR lines，缺失时 fallback 到 words，并生成 `TextSegment[]`。

### OCR provider 结构化返回

`createLocalOcrProvider().recognizePage()` 现在返回：

```js
{
  text,
  source: "ocr",
  pageNumber,
  languageSet,
  pageDimensions: { width, height },
  words,
  lines
}
```

旧逻辑仍兼容：调用方仍可通过 `result.text` 拿到纯文本。

### App 接入

- 新增 `ocrReadableChunkCache`。
- `cacheOcrPageText()` 现在会：
  - 用 `result.text` 更新 OCR 阅读速度估算。
  - 用 `segmentsFromOcrResult()` 生成 OCR `TextSegment[]`。
  - 用 `segmentsToReadableChunks()` 生成 OCR chunks。
- diagnostics 会在 `ocrEnabled` 且某页已有 OCR chunks 时优先展示 OCR chunk preview，否则 fallback 到 native chunk preview。

### 新增测试

- `tests/ocr-segment-adapter.test.mjs`
  - bbox 兼容。
  - Tesseract 原始 result 与 provider-shaped result 兼容。
  - lines 优先。
  - words fallback。
- `tests/server-range.test.mjs` 增加 `/ocr-segment-adapter.mjs` 静态资源 HEAD 测试。

## 2026-07-25：P0 坐标归一化与 chunk 质量规则

本轮提前处理“统一坐标尺度”，避免后续 `tts-segment-picker` 在 native PDF 坐标和 OCR canvas 坐标之间混乱。

### 新增模块

- `chunk-coordinate.mjs`
  - `normalizePageDimensions()`：标准化页面宽高和坐标系统。
  - `bboxToTopLeft()`：将 PDF bottom-left 坐标转换为 top-left 阅读坐标。
  - `relativeBbox()`：生成页面相对坐标，范围为 `0–1`。
  - `enrichChunkCoordinates()`：给 chunk 补充：
    - `readingBbox`：统一 top-left 绝对坐标。
    - `normalizedBbox`：统一页面相对坐标。
    - `yStart/yEnd`：统一 top-left 阅读坐标。

### Native / OCR 坐标接入

- native PDF.js textContent：传入 `pageDimensions: { width, height, coordinateSystem: "pdf" }`。
- OCR：传入 `pageDimensions: { width, height, coordinateSystem: "top-down" }`。
- diagnostics chunk preview 增加：
  - `normalizedYStart`
  - `normalizedYEnd`

后续 TTS picker 可以直接使用 `normalizedBbox.y` 和阅读线的页面相对位置进行匹配。

### 质量规则增强

`ReadableChunk` 现在新增：

- `qualityFlags`
- 更细的 `role`
- 按 role 自动降低 `priority`

新增/增强角色：

```text
body
heading
footnote
reference
formula
table
unknown
```

规则保持保守：先降权，不删除。这样后续 TTS 可以默认跳过低优先级 chunk，但 diagnostics 仍然能看到它们。

### 新增测试

- `tests/chunk-coordinate.test.mjs`
  - PDF bottom-left → top-left 坐标转换。
  - 页面相对坐标。
  - 保留 source bbox，同时生成 reading bbox。
- `tests/readable-chunk.test.mjs`
  - PDF 坐标 chunk 的统一 yStart/yEnd。
  - footnote / formula 降权与 quality flags。
- `tests/server-range.test.mjs`
  - `/chunk-coordinate.mjs` 静态资源测试。

### 下一步

P0 后续应继续补：

1. 复杂页眉页脚的跨页统计。
2. 用 Goertz PDF 实测 diagnostics 中的 nearby chunks 是否自然。
3. 再开始接 TTS scheduler，但先只接 `NullTtsProvider`。
