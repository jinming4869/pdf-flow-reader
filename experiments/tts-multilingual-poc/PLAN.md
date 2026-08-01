# 多语种 TTS 方案 A：隔离 PoC 计划

## 目的

验证“现有英文 Kokoro 链路保持不变，中文和日文改用 Kokoro ONNX + Misaki G2P”的可行性。PoC 只产出证据，不接入主应用。

## 成功标准

1. 中文和日文音素不再退化为 `Chinese letter` / `Japanese letter` 占位读法。
2. 两种语言都能在完全本地的条件下生成清晰、可理解的 24 kHz WAV。
3. 普通句、长句、数字/英文缩写混排均能生成；异常输入返回结构化错误，worker 不崩溃。
4. 热启动合成速度达到实时以下，即 `RTF < 1.0`；记录冷启动、热启动、音频时长和峰值常驻内存。
5. 持久 child process 可由父进程硬取消；取消后没有迟到音频，也不会继续占用模型推理资源。
6. 模型、字典和依赖在首次准备完成后可断网推理。
7. 明确依赖、模型大小和许可证，足以决定是否进入正式集成。

## 实施边界

- 中文：`kokoro-v1.1-zh.onnx` + `voices-v1.1-zh.bin` + Misaki `ZHG2P(version="1.1")`。
- 日文：`kokoro-v1.0.int8.onnx` + `voices-v1.0.bin` + Misaki `JAG2P(version="pyopenjtalk")`。
- Python 3.12 隔离环境；依赖锁定在本目录。
- 英文继续使用应用现有的 `kokoro-js` 链路，本 PoC 不评价或替换它。
- 不修改 `server.mjs`、`tts-provider.mjs`、`tts-worker.mjs` 或 UI。
- PoC 模型、字典、虚拟环境、临时文件和 WAV 不提交 Git。

日文明确使用 Misaki 的第二代 `pyopenjtalk` 前端。它首次运行下载约 23.6 MB 的 Open JTalk 字典；不下载约数百 MB 的完整 UniDic 数据包。

中文 v1.1 的外部 `config.json` 是必需资源。官方 Hugging Face 不可达时，准备脚本可从 `hf-mirror.com` 获取同一小文件；运行期完全不联网。

## 测试语料

每种语言至少覆盖：

- 普通学术/阅读句；
- 较长、含停顿的复句；
- 阿拉伯数字、年份、PDF/OCR/Kokoro 等英文缩写或名称混排。

速度先验证 `1.0`、`1.25`、`1.5`、`1.85`。主应用的 `2.5x` 上限不在本 PoC 中修正。

## 验证方式

- 自动检查：音素、WAV 采样率/长度、NDJSON 契约、离线运行、取消和基准指标。
- 人工检查：中文与日文各至少两段盲听，关注错音、数字、外来语、断句和速度舒适度。
- 独立复核：依据本文件逐条写入 `REVIEW.md`；未达标项不得描述为完成。

## 集成门槛

只有同时满足“语义可懂、RTF 达标、可硬取消、许可证明确”，并经用户试听认可，才提出主应用接线变更。
