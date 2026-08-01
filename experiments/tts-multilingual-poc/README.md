# Kokoro ONNX + Misaki 中日文 PoC

这是与主应用隔离的可行性验证区。模型和试听文件不进入 Git。

## 目录约定

- `models/`：本地模型、voices 和词表配置。
- `../../output/speech/multilingual-poc/`：可交付试听 WAV。
- `../../tmp/speech/multilingual-poc/`：临时文件和测试产物。

## 环境

```bash
uv sync --frozen
uv run pytest
node scripts/worker-client.mjs health
```

Python 版本和所有 Python 依赖由 `uv.lock` 固定。日文第二代前端首次运行会准备 Open JTalk 字典。

模型下载地址与校验值在 `MODEL_ASSETS.md`；模型准备好后生成试听文件：

```bash
uv run python -m scripts.generate_samples
```

验证父进程能终止正在执行的 ONNX 推理：

```bash
node scripts/worker-client.mjs cancel-demo
```

基准测试：

```bash
uv run python -m scripts.benchmark
```

中文 v1.0 int8 连续速度对照样本：

```bash
uv run python -m scripts.compare_chinese_v10
```
