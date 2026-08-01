# 独立复核

状态：技术条件通过，产品试听与中文变体选择待用户确认；不得接入主应用。

| `PLAN.md` 成功标准 | 复核结果 |
|---|---|
| 不再朗读 `Chinese/Japanese letter` | 通过；中日样本均为真实音素，未知音素 0 |
| 本地 24 kHz WAV | 通过；六段样本采样率、波形和时长有效；主观清晰度待用户试听 |
| 普通、长句、混排与结构化错误 | 通过 |
| 热启动 `RTF < 1.0` | 通过；中文约 0.21–0.29，日文约 0.44–0.79 |
| child process 硬取消 | 通过；预热后取消不产生目标文件 |
| 首次准备后断网推理 | 通过；不可达代理环境中中日文均合成成功 |
| 体积与许可证明确 | 有条件通过；已列清单，但 GPL 分发策略必须在发布前解决 |

## 独立复核发现

1. v1.1 中文分数速度不是实现细节小瑕疵，而是正式接线阻断项。PoC 已加入显式保护。
2. `espeakng-loader` 在 Unicode 路径下会使用错误的构建机路径并退出；ASCII shadow path 是必要兼容层。
3. 直接运行 `python scripts/*.py` 的模块路径不稳定，文档统一使用 `python -m scripts.*`。
4. 主应用文件、现有英语链与用户受保护文档均未被 PoC 修改。

## 复核命令

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
