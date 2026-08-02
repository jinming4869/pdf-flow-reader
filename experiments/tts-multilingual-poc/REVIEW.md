# PoC 验证摘要

状态：技术条件通过；中文正式集成选择 v1.0 与 `zf_xiaobei`。

| 成功标准 | 结果 |
|---|---|
| 中日文不再经过英语字母朗读 | 通过；样本产生真实中日文音素，未知音素为 0 |
| 本地 24 kHz WAV | 通过；采样率、波形和时长有效 |
| 普通句、长句、混排与结构化错误 | 通过 |
| 热启动 `RTF < 1.0` | 通过 |
| child process 硬取消 | 通过；取消后不产生目标文件 |
| 首次准备后断网推理 | 通过；不可达代理环境中仍可合成 |
| 体积与许可证可追踪 | 通过实验审计；正式发布另行裁剪运行时 |

## 关键发现

1. v1.1 中文 ONNX 的分数速度会被截断，不能满足连续速度需求。
2. eSpeak 数据在非 ASCII 路径中需要临时 shadow path。
3. 直接运行 `python scripts/*.py` 的模块路径不稳定，文档统一使用 `python -m scripts.*`。
4. 中日文 v1.0 可以共享模型资源，并保留连续速度控制。

## 可复现命令

```bash
uv sync --frozen
uv run pytest
node scripts/worker-client.mjs health
node scripts/worker-client.mjs synthesize zh
node scripts/worker-client.mjs synthesize ja
node scripts/worker-client.mjs cancel-demo
uv run python -m scripts.generate_samples
uv run python -m scripts.benchmark
uv run python -m scripts.compare_chinese_v10
```

自动指标验证运行正确性，不替代对音色自然度的主观判断。
