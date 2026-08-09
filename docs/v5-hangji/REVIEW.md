# v5「航迹」复核

## 2026-08-07：产品定义复核

结论：规划边界一致，可以进入工程 PoC；尚不能声明任何 v5 功能已经实现。

已确认：

- 版本主题从 v3「回音」、v4「希声」延续为 v5「航迹」。
- 产品中心是阅读中的情感体验；思维动作只是其中一部分。
- 自由套索采用“丝带环＋墨线轨迹”，套索时自动暂停。
- 情绪由用户在连续效价 × 唤醒平面亲自选择。
- 回流由用户手动触发；短中断约 30 秒，新书或长暂停约 90 秒，速度只在当前档位内提高。
- 高频一句复述与低频全文分析使用不同 AI 契约；核心留痕本地优先、AI 可失败，重型任务在线优先、用户主动触发。
- Prompt 可以继承，模型 provider 与凭据必须和 Zotero 配置解耦。
- Zotero 是 Prompt 来源与归档目的地之一，不是运行依赖；Obsidian 和本地文件夹是并列目的地。

进入实现前仍需由工程 PoC 验证：

1. 自由路径裁切在高 DPR、缩放、旋转和大型页面上的画质与内存成本。
2. 一句复述在真实网络下达到 1–3 秒的比例，以及失败补生成的队列语义。
3. 操作系统凭据存储在 Electron 打包后的跨平台可用性。
4. Zotero 图片笔记、页码回链和条目关联的正式 API 边界。
5. 30 秒 / 90 秒入流曲线对理解负担、用户控制感和现有六档逻辑的真实体验。

后续 reviewer 必须分别检查：产品边界、数据安全、离线降级、交互体验、真实 PDF 画质与双平台发布证据。

## 2026-08-07：GitHub 产品叙事复核

结论：首页不再以 v3 → v4 → v5 的版本演变为主线，而以 v5「航迹」完成后的一次连续阅读为叙事主线。为避免把产品故事误报为已经发布的功能，页首与下载区均明确标注当前公开安装包仍为 v4.0.0。

已复核：

- 故事完整经过仪式载入、档位内升温、六种阅读天气、按档位变化的 TTS、自由套索、连续情绪坐标、手动回流、异步一句复述和合卷后的 AI 书架。
- 首页直接引用“情感体验优先于思维动作”的产品定义，并把适度挑战、唤醒与虚构层写成同一条情感引擎因果链。
- 复用欢迎页、阅读界面、六档节奏、点句朗读与本地优先五组现有图片，并新增一张明确标注为概念图的“丝带环＋墨线轨迹”插图。
- GitHub GFM 渲染接口通过；README 相对链接全部可解析；SVG 已按 1280 × 640 实际栅格化检查。
- README 与新图未包含 API 密钥、用户绝对路径或旧工程目录信息。

## 2026-08-09：需求冻结复核

结论：产品所有者经过七轮选择确认全部架构级和行为级边界，并明确授权先在本机实施；需求达到冻结状态，可以从阶段 0 线性推进。

已冻结：

- v4.1 先独立收口书架与开书动画；v5 按 5.0、5.1、5.2、5.3 小版本交付。
- v5.0 是完全离线的套索、草稿留痕、情绪坐标、显式回流与单书航迹闭环。
- Electron 桌面版拥有完整能力；痕迹使用可检查文件目录与原子写入。
- PDF 内容身份和路径分离；同内容移动不丢痕，内容修订严格分书。
- 图文回声从 v5.1 开始，默认使用套索裁图与文字；无视觉能力时自动降级文字。
- 本地记录是唯一事实源；归档单向、每书一个主要目的地、Zotero 关联需确认。
- 平台先保证产品所有者本机 macOS，Windows 与 GitHub 适配后置。
- 私人 PDF、用户内容、情绪、密钥和路径不得进入 Git、云端遥测或未授权 AI 请求。

仍需 PoC 决定的内容只包括算法、画质、时延、内存、曲线与外部 API 参数；这些参数不得静默改变冻结产品行为。完整契约见 [`REQUIREMENTS.md`](./REQUIREMENTS.md)，线性执行见 [`WORKFLOW.md`](./WORKFLOW.md)。

## 2026-08-09：阶段 2 集成测试基础复核

结论：在不接触私人 PDF、不修改正式 Electron 主进程、不把测试 preload 打入生产包的前提下，已经具备可重复的本机 Electron 集成 smoke，可以进入状态机与模块边界阶段。

证据：

- 新增独立 `test:electron:smoke`；
- 保持 context isolation、sandbox 与关闭 node integration；
- 覆盖书架键盘、PointerEvent、隔离 IPC、窗口重建后的 localStorage、合成 PDF 和页面 canvas；
- Node 完整回归 297 / 297；
- Electron smoke 正常退出并可选生成截图；
- 测试脚本明确排除在正式包之外；
- 临时 userData、PDF 和服务器随测试生命周期清理。

详细记录见 [`stage-2-integration-tests/README.md`](./stage-2-integration-tests/README.md)。

## 2026-08-09：阶段 3 状态边界复核

结论：ReadingTrace 用户事实契约与一次性套索会话已经成为两个零 DOM、零磁盘、零网络依赖的纯模块；v4.1 UI 与阅读行为未改变，可以进入本地事实源阶段。

关键证据：

- draft / active / trashed / purged 生命周期和 crop / emotion 独立状态均有失败测试；
- 裁图失败可重试，不删除 trace；
- originalEmotion 不可被修正覆盖；
- save-error 不能静默回流；
- generation 阻止文档切换后的迟到保存结果；
- 严格序列化往返与不支持 schema 失败；
- Node 完整回归 311 / 311；
- Electron integration smoke 通过；
- 新模块已经进入桌面包和本地静态服务，但尚未被 app.mjs 调用。

详细记录见 [`stage-3-trace-state/README.md`](./stage-3-trace-state/README.md)。

## 2026-08-09：阶段 4 本地事实源复核

结论：可检查文件目录、原子写入、损坏恢复、乐观并发、回收站、正式 preload 与来源受限 IPC 已形成完整本地事实源；app.mjs 尚未使用，因此现有阅读行为保持不变。

关键证据：

- 同文档并发创建保持 readingOrder 单调且不重复；
- 失败 Promise 不会毒化后续写队列；
- 损坏的 trace 与 document 被隔离到 recovery；
- trashed 记录可恢复，只有到期或明确确认后 purge；
- preload 不暴露原始 ipcRenderer，repository 不经 HTTP 暴露；
- 非本地 renderer 被拒绝；
- plain error envelope 在真实 Electron 中保留 `TRACE_REVISION_CONFLICT`；
- Node 完整回归 326 / 326，Electron smoke 通过。

详细记录见 [`stage-4-local-trace-store/README.md`](./stage-4-local-trace-store/README.md)。

## 2026-08-09：阶段 5 套索与裁图 PoC 复核

结论：归一化套索几何、双栏文字命中、旋转 PDF canvas、高 DPR 区域裁图和 PNG 原子持久化均已在本机形成证据，可以进入正式阅读界面接入。

关键证据：

- 页面外指针拒绝、采样去重、RDP 简化、Chaikin 平滑和面积门槛均有单元测试；
- 双栏中缝不会把右栏文字带入左栏套索，native 与 OCR provenance 能形成 mixed；
- 旋转合成 PDF source canvas 为 1880×1453，裁图正常；
- 3000×4000 canvas 在 4M 输出预算下生成约 1.05MB PNG；
- 最后一组 5 次 P50 69.6ms、P95 70ms、max 79ms，开发冷峰值约 172ms；
- renderer PNG 已经通过正式 preload / IPC 原子写入 repository 并更新为 CROP_READY；
- Node 完整回归 339 / 339，Electron smoke 通过。

真实扫描书、复杂双栏和大型私人 PDF 仍需在阶段 6 与阶段 10 继续验收。详细记录见 [`stage-5-lasso-crop-poc/README.md`](./stage-5-lasso-crop-poc/README.md)。

## 2026-08-09：阶段 6 正式草稿留痕复核

结论：丝带环、L / Esc、墨线、自动暂停、TTS 取消、视口冻结、draft、PNG 和最小保存面板已经在正式 app.mjs 路径完成；情绪和正式回流尚未接入，因此仍不是可发布 v5.0。

关键证据：

- 正式 UI 只在桌面 repository 可用且 PDF.js fingerprint 注册成功时出现；
- 未武装时现有文字选择和点句事件不被拦截；
- 真实 PointerEvent 套索产生一条 crop ready 的本地 trace；
- 保存期间按钮、冻结状态、面板和预览均与状态机一致；
- 返回后面板隐藏、视口解冻；
- L → Esc 前后 trace 数量不变且播放保持暂停；
- app.mjs 不包含套索或裁图算法；
- Node 完整回归 342 / 342，Electron UI smoke 通过。

详细记录见 [`stage-6-draft-capture/README.md`](./stage-6-draft-capture/README.md)。

## 2026-08-09：阶段 7 连续情绪坐标复核

结论：连续效价 × 唤醒平面、pointer、键盘、邻域词、aria-valuetext 和持久化已接入；crop 与 emotion 并发不再产生 revision 覆盖，可以进入正式回流阶段。

关键证据：

- pointer 落点 75% × 25% 保存为 valence 0.5、arousal 0.5；
- UI 与无障碍文字显示相同坐标和“振奋、惊喜、兴奋”；
- ArrowLeft 把 current 改为 0.45 / 0.5；
- original 仍为 0.5 / 0.5，emotionState 变为 revised；
- cropState 同时保持 ready；
- 未落点仍可直接返回；
- Node 完整回归 347 / 347，Electron smoke 通过。

详细记录见 [`stage-7-emotion-coordinate/README.md`](./stage-7-emotion-coordinate/README.md)。
