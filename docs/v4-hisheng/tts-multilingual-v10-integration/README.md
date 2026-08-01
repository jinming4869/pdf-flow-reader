# 中日文 TTS v1.0 正式接线

本目录是这轮应用接线的可审阅工作面。技术依据见 `PLAN.md`、`DECISIONS.md`，完成证据见 `REVIEW.md`。

## 本地开发资源

正式代码自动按以下顺序发现资源：

1. `PDF_FLOW_TTS_PYTHON`、`PDF_FLOW_TTS_MODELS_DIR`、`PDF_FLOW_TTS_WORKER` 环境变量；
2. 安装包预留的 `resources/tts-multilingual/`；
3. 开发工程的 `experiments/tts-multilingual-poc/.venv` 与 `models/`。

当前开发机走第 3 条。虚拟环境由 PoC 的 `uv.lock` 固定，模型目录只需保留这两个文件：

- `kokoro-v1.0.int8.onnx`
- `voices-v1.0.bin`

下载地址、字节数和 SHA-256 见 [`MODEL_ASSETS.md`](../../../experiments/tts-multilingual-poc/MODEL_ASSETS.md)。模型、虚拟环境、日文字典和生成音频均不进入 Git。

## 验证

```bash
npm test
cd experiments/tts-multilingual-poc && .venv/bin/python -m pytest -q
cd ../.. && experiments/tts-multilingual-poc/.venv/bin/python -m pytest -q tests/tts_multilingual_worker_test.py
npm run test:tts-multilingual:smoke
```

最后一条命令会真实启动应用 HTTP 服务，验证中文四档连续速度、中英混排、日文路由、活动推理硬取消与 worker 重建，并把可试听 WAV 写入 `output/speech/integration-v10/`。

## 发布边界

本阶段没有把开发机 `.venv` 伪装成可发布 runtime。发布前仍需完成跨平台 Python/runtime 组装、日文字典随包、模型分发和 GPL/eSpeak 合规决策；未完成这些工作前，现有 Release 不应宣称已内置这条中日文链。
