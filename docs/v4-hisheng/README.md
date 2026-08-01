# v4「希声」文档索引

这个目录只负责解释文档关系。当前执行依据仍放在仓库根目录，便于每次工作开始时直接读取。

## 当前执行文件

| 文件 | 用途 |
| --- | --- |
| [`GOAL.md`](../../GOAL.md) | 当前完成线与明确排除项 |
| [`PLAN.md`](../../PLAN.md) | 分阶段执行顺序和验收标准 |
| [`CONTEXT.md`](../../CONTEXT.md) | 当前代码、分支、问题和样本事实 |
| [`DECISIONS.md`](../../DECISIONS.md) | 已锁定的产品与技术决定 |
| [`TODO.md`](../../TODO.md) | 任务状态 |
| [`REVIEW.md`](../../REVIEW.md) | 独立复核和验证证据 |

## v4 资料

| 文件 | 性质 | 当前用法 |
| --- | --- | --- |
| [`docs/PRD_v4.0_HISHENG_TTS.md`](../PRD_v4.0_HISHENG_TTS.md) | 初版产品 PRD | 保留背景、原则和非目标；旧三态模式已被根目录新决策覆盖 |
| [`docs/ENGINEERING_LOG_v4.0_HISHENG_PHASE1.md`](../ENGINEERING_LOG_v4.0_HISHENG_PHASE1.md) | Phase 1 施工快照 | 用于追溯已经做过什么和真实运行问题，不作为当前 TODO |
| [`docs/IMPLEMENTATION_v4.0_HISHENG.md`](../IMPLEMENTATION_v4.0_HISHENG.md) | 早期实现日志 | 记录 ReadableChunk、native text 和 OCR 结构化过程 |
| [`docs/TTS_CHUNK_OCR_INTEGRATION_v4.0.md`](../TTS_CHUNK_OCR_INTEGRATION_v4.0.md) | 早期设计说明 | 部分内容已实现或过时，历史参考 |
| [`docs/TTS_MODEL_DECISION_v4.0.md`](../TTS_MODEL_DECISION_v4.0.md) | 模型路线草案 | 暂停执行；内部逻辑稳定后重新 PoC |
| [`docs/TTS_PROVIDER.md`](../TTS_PROVIDER.md) | v3 时期接口草案 | 作为 Provider 设计历史 |
| [`docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md`](../COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md) | 外部工程调研 | 提供隔离、下载、时间戳、缓存与取消方面的参考，不直接决定产品 |

## 中日文模型工作流

| 目录 | 状态 | 当前用法 |
| --- | --- | --- |
| [`experiments/tts-multilingual-poc/`](../../experiments/tts-multilingual-poc/) | PoC 已完成 | 保存模型对照、性能、离线与硬取消证据；用户已选择中文 v1.0 |
| [`tts-multilingual-v10-integration/`](./tts-multilingual-v10-integration/) | 正式接线 | 保存 v1.0 中日文 worker、应用路由、测试与发布边界的本轮依据 |

## 规则

- 一个决定只在 `DECISIONS.md` 锁定，不在多份日志里重复宣布。
- 一个任务只在 `TODO.md` 维护状态，施工日志只记录已经发生的事实。
- `PLAN.md` 改变执行顺序时，应同步检查 `GOAL.md` 和 `DECISIONS.md`。
- 每轮实现完成后，由 reviewer 更新 `REVIEW.md`；仍有 P0/P1 时不能进入模型 PoC 或发布。
- 不向仓库提交个人 PDF、模型缓存、生成音频、API key 或安装包。
