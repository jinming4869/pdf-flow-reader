# 阶段 3：ReadingTrace 契约与套索会话状态机

状态：**本机通过，尚未接入 UI 或磁盘**

日期：2026-08-09

基线：`b9955ac`（阶段 2 Electron 集成测试基础）

## 范围

阶段 3 只建立纯函数边界：

- `reading-trace.mjs`：单条阅读痕迹的严格数据契约、生命周期、裁图状态、情绪状态、回收站与序列化边界；
- `trace-session.mjs`：一次性套索会话的 transient 状态、事件、允许转移和交给 app.mjs 的副作用描述；
- 两个模块均不访问 DOM、Electron、Node 文件系统或网络；
- 不接入套索 UI，不写磁盘，不改变 v4.1 运行行为。

## ReadingTrace 契约

草稿建立时包含：文档身份、页码、归一化路径、文字及来源、速度档位、物理速度、阅读顺序和时间。

独立状态轴：

```text
lifecycle: draft | active | trashed | purged
crop: pending | ready | failed
emotion: unplaced | placed | revised
```

关键不变量：

- 套索闭合后立即形成 draft；
- 裁图失败不删除 trace，可以 `RETRY_CROP`；
- 首次放置情绪后 trace 进入 active；
- `originalEmotion` 在修正时保持不变；
- trashed trace 只允许 RESTORE 或经明确确认的 PURGE；
- purged trace 不再允许持久化；
- crop reference 必须是文档目录内安全的相对路径；
- AI 和归档字段不进入核心 trace 文件。

序列化：

- `toReadingTraceRecord` 返回脱离内部冻结对象的 JSON 记录；
- `fromReadingTraceRecord` 严格校验 schema 与不变量；
- 不支持的旧 schema 明确失败，不做猜测性迁移。

## TraceSession 状态机

```text
idle
→ armed
→ drawing
→ saving
→ reviewing
→ explicit RETURN_TO_FLOW
→ idle + BEGIN_REFLOW effect
```

保存失败路径：

```text
saving → save-error → RETRY_SAVE → saving
                    → explicit DISCARD → idle + KEEP_PAUSED
```

关键语义：

- ARM 只输出 PAUSE_READING、CANCEL_TTS、FREEZE_VIEWPORT；
- Esc、右键、路径过短或跨页手势不创建 trace，并输出 KEEP_PAUSED；
- SAVE_SUCCEEDED 只有 generation 匹配时才进入 reviewing；
- 文档切换 RESET 会增加 generation，迟到保存结果被忽略；
- 未成功保存不能静默“回到书流”；
- 只有 reviewing 中明确 RETURN_TO_FLOW 才输出 BEGIN_REFLOW。

## 与独立审查的取舍

独立审查建议“绘制取消后留在 armed 以便重画”。冻结需求 D29 已明确完成或取消后退出一次性套索模式，因此实现保持 `idle + KEEP_PAUSED`；用户可以再次按 `L` 重新武装。

审查指出旧 `storage.mjs` 的文件名／大小／修改时间指纹不满足内容身份要求。阶段 3 仅要求调用方提供严格 `documentFingerprint`，不复用旧算法；真正的内容指纹与迁移在阶段 4 设计。

`readingOrder` 是不可重编号的插入序号；跨痕迹单调性由阶段 4 repository 保证。

## 测试证据

新增 14 项测试：

- 草稿默认状态与字段分离；
- 归一化路径、文档锚点和情绪边界校验；
- crop 失败、重试和完成；
- 情绪首次落点与修正；
- 30 天回收站、恢复、确认后 purge；
- 严格序列化往返；
- ARM 副作用；
- 同页有效手势；
- 取消、短路径和跨页路径；
- 保存成功、失败、重试与显式放弃；
- generation 使迟到结果失效；
- 桌面包与本地静态服务均包含两个模块。

验证结果：

- 新增测试：14 / 14；
- Node 完整回归：311 / 311；
- Electron integration smoke：通过；
- `reading-trace.mjs` 与 `trace-session.mjs` 无 DOM、Electron 或文件系统依赖；
- v4.1 UI 与阅读行为未修改。

## 下一阶段

阶段 4 建立 Electron 正式 preload / IPC 和本地 trace repository：

- 内容身份与路径定位；
- 原子目录写入；
- 并发排序；
- 损坏恢复；
- schema migration；
- 30 天回收站与 purge；
- 仍不接入套索视觉 UI。
