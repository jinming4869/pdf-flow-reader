# 技术概览

本文汇总当前公开版本的架构背景、运行边界与验证方式。

## 当前基线

- 当前发布版本：v4.0.0
- 正式平台：macOS Apple Silicon、Windows x64
- 核心界面：原生 HTML、CSS 与 JavaScript
- PDF 渲染：PDF.js
- 本地 OCR：Tesseract.js
- 本地朗读：Kokoro、ONNX Runtime 与独立 worker

## 运行链路

```text
PDF 文件
→ 分段读取或浏览器 File transport
→ PDF.js 页面与文字层
→ 原生文字质量判断
→ 必要时调用本地 OCR
→ ReadableChunk / TextSegment
→ 六档阅读策略
→ 本地 TTS worker
→ Web Audio 播放
```

## 关键边界

- 本地服务只监听 `127.0.0.1`。
- 原生文字质量足够时不启动 OCR。
- OCR 结果同时服务于扫描页朗读和阅读速度估算。
- TTS 推理运行在独立进程中，避免阻塞 PDF Range、渲染和心跳请求。
- 跳页、暂停、停止和换文档会使旧朗读请求失效。
- 大文件按区间读取，页面画布按设备内存和像素预算逐出。

## 验证方式

公开版本通过以下层次验证：

- Node 单元与集成测试
- Python worker 单元测试
- JavaScript 与 shell 语法检查
- macOS 与 Windows 原生打包
- 打包后离线模型和 worker 冒烟测试
- Release 资产数量与 SHA-256 校验

具体测试数量和版本变化以 [`CHANGELOG.md`](./CHANGELOG.md) 与 GitHub Actions 记录为准。

## 已知限制

- OCR 与 TTS 都可能产生识别或发音误差。
- 当前发布包未进行正式开发者签名。
- Intel macOS 与 Linux 暂无正式发布资产。
- 完整应用级端到端测试仍可继续扩展。
