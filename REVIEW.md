# 复核记录

## 2026-07-31：v4「希声」内部逻辑目标终验

结论：通过。`GOAL.md` 八项完成线均有代码、自动化或真实 PDF 证据；主线程 planner / executor / reviewer 终轮未发现 P0/P1/P2。代码检查点为 `3e62a21`，当前目标可以关闭并转入模型 PoC。

本轮发现并修正：

- 在 584 页扫描书持续朗读时，初始 ±2 OCR 窗口会耗尽。进入已经 OCR-ready 的边缘页后，旧逻辑不会识别新出现的前方页，最终会让雪国跨页预取失去文本。
- 新调度门禁只在雪国朦胧已开启且正在播放、OCR 空闲、下一页 native 已确认不足、尚无 OCR 结果 / 任务 / 失败时返回前向目标页。其他档位、暂停、文末和已有结果都保持安静。
- 应用在普通 TTS tick 的所有音频早退之前尝试该门禁，使当前句仍在播放时即可准备下一扫描页；OCR 工作本身继续复用既有 debounce、状态机和最多五页过滤。

真实验证证据：

- 样本为 584 页、262,204,688 字节的全扫描英文书，服务使用 HTTP Range；真实本地 Tesseract 与 Kokoro child process 同时运行。
- Kokoro 使用 q8、`af_heart`、1.18x，输出 24 kHz WAV；完整验证期间 scheduler / audio 失败均为 0。
- 朗读中从第 30 页远跳第 100 页，generation 立即由 7 变 8，活动音频停止，之后只播放第 100 页内容，证明旧朗读和旧推理结果没有越界。
- 第 101→102 页有精确跨页证据：越页前预取槽为下一页首个合格正文 chunk；越页后 generation、queued 与 stopped 不变，completed 与 prefetchUsed 增加。
- 修复后停留第 105 页时，第 106 页由 `ocr-needed` 自动变为 `ocr-ready`；自然越入第 106 页后，第 107 页继续自动完成 OCR，证明前向窗口会持续移动。
- 第 105→106 页自然越页期间 generation 保持 7、audio stopped 保持 1、失败为 0；completed 从 16 增至 20，prefetchUsed 从 9 增至 12，实际音频未因补扫或越页中断。

自动与静态验证：

- 新增纯门禁回归，覆盖档位、总开关、暂停、OCR 忙碌、native 未知、已 ready、已有 OCR、失败和文末。
- `npm test`：273/273 通过。
- `node --check app.mjs ocr-schedule.mjs`、`git diff --check`：通过。

保留限制：

- Tesseract 当前 core / traineddata 组合会输出若干未知参数提示，但识别能完成且没有应用级失败；模型与 core 必须在下一阶段 PoC 中成套比较。
- 当前真实 TTS 长跑验证的是英文 Kokoro 路线，不代表中文、日文默认声音已经决定。
- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 40 行本地改动保持未暂存、未提交。

## 2026-07-31：雪国朦胧跨页连续预取实现

结论：代码与自动验证通过，检查点为 `75854a3`；未发现 P0/P1/P2。真实 PDF 长时间运行验收尚未执行，因此当前 `GOAL.md` 继续保持“进行中”。

本轮完成：

- 应用把下一页可读 chunks 作为独立预取池交给雪国朦胧；当前页 picker 不会误选下一页顶部文字。
- scheduler 可在当前页最后一个 chunk 播放时生成下一页首个 chunk，并在普通相邻向前翻页后直接复用。
- 页码 metadata 改为目标 chunk 的真实页码；OCR / native 或正文内容变化时，同 key 的旧预生成也会因内容签名不一致而作废。
- 普通向前翻页才保留雪国会话；倒退、远跳、同页大幅跳读与其他档位仍取消。大幅跳读门禁从只覆盖流觞曲水扩展到所有已开启的希声档位。

验证证据：

- `npm test`：272/272 通过。
- 40 页连续压力测试：40 个 chunk 各合成一次，39 次跨页预取全部复用，失败为 0。
- 跨页来源变化回归：已预生成的旧 OCR 文本不会在同 key 的新 native / 校正文本文字上复用。
- `node --check` 与 `git diff --check`：通过。
- 重复执行 `npm run app:dir` 时，已有运行约 7 天的应用占用 `dist/mac-arm64`，构建停在 packaging；为不擅自关闭用户应用已用 SIGINT 终止。本阶段没有新增打包文件，前一检查点已成功验证现有模块清单。

待验收：

- 关闭或另开旧构建后，以新代码在真实 PDF 上连续跨过多页，确认实际 Kokoro 音频无断链、无旧句重放、跳读可立即止声。
- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 40 行本地改动继续保持未暂存、未提交。

## 2026-07-31：美学散步动态跟速

结论：通过。主线程 reviewer 阶段未发现 P0/P1/P2；代码检查点为 `54303c2`。其后的雪国朦胧跨页实现已由 `75854a3` 补齐，仍待真实长时间验收。

本轮完成：

- 用当前阅读线、chunk 几何、页面像素高度与 px/s 计算剩余视觉窗口，在 1.5–2.5 倍之间选择能跟上纸页的最低语速。
- 整段无法放入视觉窗口时缩短到完整首句；首句仍无法放入则静默跳过，不启动推理、不追赶、不重叠。
- scheduler 让下一 chunk 的预生成携带自己的文本、速度与绝对截止时刻；同档调速导致计划变化时丢弃旧预生成并重做。
- 合成结果在最晚安全起点之后返回时不进入音频层，播放锁立即释放；UI 以轻松文案说明动态范围与静默略过。
- 新策略模块已登记到本地静态服务与 Electron `build.files`。

reviewer 补测：

- 速度计划从 1.6x 变为 2.35x 且正文缩为首句时，已经 ready 的旧预生成不能被复用；新计划会重新合成，`prefetchUsed` 保持 0。
- 缺少布局数据时只回退到 1.5x；有布局时语速不越过 1.5–2.5x，句界缩短对中日韩和英文共用既有可靠切分。

验证证据：

- `npm test`：267/267 通过。
- `node --check`：`app.mjs`、`tts-aesthetic-walk.mjs`、`tts-controller.mjs`、`tts-scheduler.mjs`、`tts-policy.mjs`。
- `git diff --check`：通过。
- `npm run app:dir`：macOS arm64 目录包成功生成，新模块位于应用 Resources；当前机器无 Developer ID，因此仍有既知的未签名提示，且项目沿用既有 `asar: false`。

保留限制：

- 本阶段开始前已结束真实浏览器会话，因此没有追加一次新的 PDF 目测；算法、应用参数接线、静态服务、打包与取消时序由自动测试覆盖。
- 雪国朦胧的跨页连续预取仍需用真实 PDF 长时间运行验收，完成后才能关闭当前 `GOAL.md`。
- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 40 行本地改动继续保持未暂存、未提交。

## 2026-07-31：固定多语样本与 OCR 加固

结论：通过。主线程 reviewer 阶段未发现 P0/P1/P2；代码检查点为 `9f1ffec`。其后的美学散步动态跟速已由 `54303c2` 完成。

本轮完成：

- 修复英文双栏论文窄中缝跨栏拼句，并同时保护 readable chunk 与完整点句 target。
- OCR 渲染目标宽度提高到 1600 px、最高 3.2 倍；文档标签和首次可靠结果会学习英文、简中、繁中或日文混合语言组合。
- 中日文 OCR 点句改用 line bbox，英文 OCR 保留 word bbox；清除扫描边框产生的行首尾竖线。
- 新增日文列表句形门槛。扫描结果可以校准速度估算但不一定取得朗读资格，避免高置信度词汇表被当作连续正文。
- 试验官方 `tessdata_best` 日文模型后确认与当前浏览器核心不兼容，已恢复原二进制；本提交没有模型文件变化。

真实证据：

- 15 页英文双栏论文第 3 页：左右栏不再同句拼接；点击左栏完整句后显示“正在准备你点到的这句话 · 1.25x”，一个高亮保持在第 3 页。
- 590 页中文扫描书第 50 页：10 个 OCR chunks、加权置信度约 0.855、`ocr-ready`；最高档形成 13 个跨行完整句目标。
- 282 页日文扫描教材第 80 页：10 个 OCR chunks、加权置信度约 0.811、句末块比例 0.5、`ocr-ready`；点按“会社は郊外にあります。”后进入准备并显示一个高亮。
- 同一教材第 50 页：加权置信度约 0.718，但句末块比例约 0.333，正确为 `ocr-poor`；朗读关闭，速度估算仍显示字/分与词/分。

验证证据：

- `npm test`：253/253 通过。
- `node --check`：`app.mjs`、`ocr-provider.mjs`、`ocr-segment-adapter.mjs`、`readable-chunk.mjs`、`text-source-state.mjs`。
- `git diff --check`：通过。
- 当前模型下的最终中文、日文浏览器会话没有新应用错误；日志中只保留已隔离的新端口 `tessdata_best` 兼容性试验错误。

保留限制：

- OCR 可读性明显改善，但真实中文和日文样本仍有模型级误字；本轮不声称逐字准确。
- 尚无完整 app DOM/E2E 编排测试；真实 PDF 证据仍由浏览器诊断与纯函数回归共同承担。
- 当时尚未完成的美学散步动态跟速现已由 `54303c2` 补齐；雪国朦胧跨页预取长时间验收仍保留。
- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 40 行本地改动继续保持未暂存、未提交。

## 2026-07-31：强风吹拂 / 万物繁盛点句朗读

结论：通过。独立 reviewer 三轮复核后未发现剩余 P0/P1/P2；代码检查点为 `29cfa4d`。

本轮完成：

- 最高两档只显示顶部“点击以朗读”总开关，不自动发声、不显示阅读线，底部不重复希声控制。
- native 与 OCR 坐标生成中英日完整句 target；支持跨行多 fragment、双栏命中、OCR word 优先与旋转 PDF viewport 映射。
- hover、主键短按、拖选区分、柔和整句高亮、独立滚动 hold、自然结束恢复、用户干预不恢复和 A → B 最后点击优先均已接线。
- 点句复用统一取消链，旧音频、解码、scheduler、fetch 和 child inference 一起作废；显式 sentence target 不经过阅读线 picker。
- Electron build files 与本地静态服务已登记三个新模块。

复核过程：

1. 首轮发现朗读中的高亮会被另一句 hover 覆盖，以及单字母 initials 规则会把 `Plan A. Next sentence.` 错并成一句。
2. 二轮确认 hover 已修，但发现 `Appendix A. Results follow.` 等学术标签仍被人名启发式吞掉。
3. 最终以 active-session hover gate、学术标签前缀反例和人名 initials 正例共同校准；纯触屏入口改用 any-hover / any-pointer 能力隐藏。终轮无 P0–P2。

验证证据：

- `npm test`：241/241 通过。
- `node --check`：`app.mjs`、`server.mjs`、`text-segment.mjs`、`tts-controller.mjs`、`tts-sentence.mjs` 与三个 point-read 模块。
- `git diff --check`：通过。
- 30 页原生英文 PDF 在 40 / 64 px/s 显示顶部点句入口、隐藏底部控制；20 px/s 恢复长日留痕底部控制。
- hover 命中稳定句子 key 与多 fragment 高亮；点句时自动滚动停止，自然结束恢复；滚轮干预取消并保持暂停；A → B 只保留 B。
- 390 × 780 窄屏无横向溢出，控制台 warning / error 为 0。

保留限制：

- 尚无完整 app DOM/E2E 编排测试；核心边界目前由纯函数、controller、静态服务、打包清单和真实浏览器目测共同覆盖。
- 浏览器自动化后端无法可靠制造原生 Selection，因此不声称完成真实拖选手势目测；DOM 可选择层和 gesture gate 已有代码与回归证据。
- 中文 OCR、英文双栏和日文点句仍需固定真实样本验收；美学散步动态 1.5–2.5 倍跟速仍未实现。
- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 40 行本地改动继续保持未暂存、未提交。

## 2026-07-26：流觞曲水段首声场

结论：通过。独立 reviewer 最终未发现 P0/P1/P2；可以作为最高两档点句朗读的下一阶段基线。

提交：

- `50f24d5 feat(v4): model paragraph crossings for winding stream`
- `7ea78da feat(v4): connect winding-stream paragraph playback`

本轮完成：

- 原生文字与 OCR 都能形成带段落、段首句、页面碎片和相对坐标的 passage；双栏顺序与保守跨页连续段有永久测试。
- 纯 crossing reducer 区分段首 prepare、段尾 play / discard、同坐标事件顺序、初始位置、快进、暂停、跳转和上下文变化。
- scheduler 新增显式 prepare / play / discard 单槽协议。段尾调用不会 await；只有 ready 的同 key、同 context 结果可以播放，late / stale / busy 立即丢弃。
- controller 将流觞曲水接入段落 reducer；应用只维护当前页前后各一页的段落窗口，正常相邻前进保留预载，倒退、远跳和有效来源变化作废。
- 非选中 OCR 来源和窗口外 OCR 完成不会反复取消当前段首；旧 continuous prefetch 的迟到回调也不能清除同 key 的新槽位。

复核过程：

1. 段落模型首轮发现同坐标事件顺序、gap / 文末 bootstrap 和跨页页边门槛问题，修正后通过。
2. 调度接线首轮发现旧 continuous 回调可能清除新槽位，以及全局 OCR revision 会让当前预载反复失效，修正后通过。
3. 二轮发现完整窗口成员被写入 context key，导致正常相邻翻页也重置。最终改为滑动窗口快照与单调 content revision，只比较重叠页。
4. 终轮覆盖空窗口、倒退 / 跳转、新文档、来源切换和 session generation，未发现剩余 P0–P2。

验证证据：

- `npm test`：220/220 通过。
- `node --check`：`app.mjs`、`tts-controller.mjs`、`tts-scheduler.mjs`、`tts-paragraph-flow.mjs`。
- `git diff --check`：通过。
- 584 页扫描书以 25 px/s 从第 11 页连续进入第 12、13 页，段首预载状态跨页保留；流觞曲水没有可见阅读线，也没有最高两档点句按钮。
- 应用内浏览器控制台 warning / error 为 0。

范围边界：

- 本轮没有实现美学散步的 1.5–2.5 倍动态跟速，也没有实现强风吹拂 / 万物繁盛的顶部点句朗读、高亮和滚动恢复。
- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 40 行本地改动继续保持未暂存、未提交。

## 2026-07-26：CJK 句界、六档策略与前三档接线

结论：通过。独立 reviewer 最终未发现 P0/P1/P2；检查点可以继续作为流觞曲水实现的基线。

提交：

- `ace00aa refactor(v4): define six-tier Hisheng policies`
- `80188cd refactor(v4): wire Hisheng master switch and tier gates`

本轮完成：

- 中文、日文无空格句界正确保留句末闭引号；英文小数与常见缩写不被误切。
- 六档由深冻结的纯策略表描述；旧 `off / whisper / flow` 只迁移为一个布尔总开关。
- `H` 只切总开关；`R` 只属于已开启的长日留痕，并和乐符按钮调用同一个 action。
- 雪国朦胧、美学散步和长日留痕只执行已经具备底层能力的行为；流觞曲水和最高两档不会用旧 flow 冒充。
- 跨档策略切换经过统一取消边界，总开关保持不变。
- 长日留痕严格选择“句子起点位于阅读线下方”的最近一句，可重复点读；阅读线穿过的句子会被排除。
- 本地偏好写回时删除 `ttsMode`、`ttsPreferredMode` 和 `ttsConsentGiven`，并尊重新授权字段优先级。

复核过程：

1. 首轮指出 CJK 短句、闭引号、英文缩写和不完整括号边界；修正后通过。
2. 接线首轮指出未实现档位可能被伪装、长日目标不够严格、暖机 promise 竞态、旧偏好字段复活和美学散步文案过度承诺；均已修正。
3. 终轮指出未实现档位提示可能被滚动状态覆盖、穿线句仍可能被选择、旧授权字段迁移顺序错误；补回归后通过。

验证证据：

- `npm test`：191/191 通过。
- `node --check`：`app.mjs`、`storage.mjs`、`tts-controller.mjs`、`tts-policy.mjs`、`tts-preferences.mjs`、`tts-segment-picker.mjs`、`tts-sentence.mjs`。
- `git diff --check`：通过。
- Reviewer 对最后三个边界的针对性测试：19/19 通过。

限制：

- 应用内浏览器控制会话在本轮不可用，因此没有新增 UI 目测证据。乐符位置、禁用状态和窄屏表现仍须在后续可用的本地预览中验收。
- 流觞曲水段落事件、最高两档点句交互、美学散步动态跟速、雪国朦胧跨页预取仍未完成。
- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 本地改动继续保持未暂存、未提交。

## 2026-07-25：v4 文本来源状态机

结论：通过。独立 reviewer 未发现代码 P0/P1/P2；可以提交。

本轮完成：

- native 与 OCR 质量评估收敛为逐页状态机，能够解释 checking、needed、scheduled、running、ready、poor 与 failed。
- native-ready 直接开放希声，不再要求先“开启 OCR”。native 缺失或质量不足时，才自动调度当前页 ±2、最多 5 页 OCR。
- OCR failed / poor 不自动循环；翻页取消旧 OCR workload；当前页朗读来源切换时经过统一取消入口。
- native-ready 页仍可手动“扫描页增强”，合格 OCR 只校准速度估算，朗读 chunks 保持 native。
- Tesseract 7 显式请求 `blocks`，并从 block / paragraph 恢复 line、word 和 bbox。真实扫描页已能生成 OCR chunks。
- 修复 CLI 未传 `--idle-ms` 时误删 PDF 首个位置参数的问题。

真实证据：

- 311 页英文书正文页：`native-ready`，9 个 native chunks，希声入口可见可用；OCR 没有自动启动，纯英文页只显示“词/分”。
- 584 页、262,204,688 字节扫描书：首屏约 1.1 秒进入 `ocr-running`，相邻页为 `ocr-scheduled`；约 27 秒内其中一页得到 15 个 OCR chunks、加权置信度约 0.931，并切为 `ocr-ready`。
- Poppler 渲染目测确认英文原生页与扫描页内容清晰，OCR 预览与扫描纸面正文一致。
- 应用内浏览器 warning / error 为 0。
- 全量自动化最终为 169/169；全部 `.mjs` 语法、两个 shell 启动脚本和 `git diff --check` 通过。
- 使用本地 Electron distribution 完成 macOS arm64 解包构建；`text-source-state.mjs`、OCR 适配器、TTS runtime / worker 与 Tesseract 资源均存在于 `.app/Contents/Resources/app/`。

独立 reviewer 的加固意见：

1. Tesseract 同时暴露 block.lines 与 paragraph.lines 时可能重复。已改为 paragraph lines 优先，并补永久测试。
2. CLI 缺少 `--port-file` 组合测试。已补带 PDF 与不带 PDF 两条测试。
3. 仍保留一个 P3：app 层没有可注入的完整 DOM 状态机测试，当前由 reducer / scheduler 单测与真实浏览器诊断共同覆盖。进入六档交互重构时，应先把 app orchestration 拆成可测试控制器。

提交边界：

- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 40 行本地改动与本轮无关，必须继续保持未暂存、未提交。
- 因 `docs/**/*` 会进入 Electron 包，正式发布构建必须从干净提交生成；本轮解包构建只是本地验证，不是发布资产。

## 2026-07-25：v4 基础可靠性修复

结论：通过，独立 reviewer 最终未发现剩余 P0/P1/P2；可以提交。

本轮完成：

- OCR debounce 改为有身份的 pending / active 调度，同页刷新不重置期限，换页只替换待启动任务。
- 页码变化、暂停、换 PDF、关闭希声和手动止声统一作废 TTS controller、scheduler、预生成、播放锁、阅读线和异步音频解码。
- renderer 的 fetch abort 会传到 server；活动 Kokoro 推理由 child process 的 `SIGKILL` 硬停止，迟到结果同时受 request id 和 child generation 隔离。
- TTS child 保持单并发、8 项队列上限、120 秒超时、崩溃后重建；PDF Range 与 heartbeat 留在父进程。
- `R` 经过 PDF、控制可见性、速度档、希声模式、当前页 chunks 和预热门槛；手动触发可以重读当前句。
- Electron 构建清单加入 OCR scheduler、TTS runtime client 与 worker。

独立 reviewer 首轮发现并退回了 1 个 P1、3 个 P2：

1. 取消等待中的 prefetch 后，旧页可能落回普通合成路径。
2. `controller.stop()` 没有使在途 tick 失效，旧页状态可能在取消后写回。
3. OCR 快速 A → B → A 时，旧 active A 会错误遮住最新 A。
4. server 等活动 TTS 结束后才关闭 runtime，退出可能滞留到 120 秒。

修正后，reviewer 又发现一个 P2：当前句已经读过时，`R` 会假报 speaking，却不重新合成。最终实现只让自动朗读复用 `currentKey`，手动触发会重新合成。

验证证据：

- `npm test`：147/147 通过。
- `node --check`：`app.mjs`、`server.mjs`、`ocr-schedule.mjs`、`tts-audio-player.mjs`、`tts-controller.mjs`、`tts-provider.mjs`、`tts-runtime-client.mjs`、`tts-scheduler.mjs`、`tts-worker.mjs`。
- `sh -n`：`start-reader.sh`、`start-reader.command`。
- `git diff --check`：通过。
- 使用本地 Electron distribution 完成 macOS arm64 解包构建，三个新增入口都存在于 `.app/Contents/Resources/app/`。
- 真实 CPU 忙循环 child 合成期间，heartbeat 与 PDF Range 集成测试保持响应。
- 活动 TTS 期间调用 `server.close()` 的测试约 6 ms 完成，不再等待推理超时。

范围边界：

- 本轮没有提前实施 native-first、附近页 OCR 自动补救、CJK 首句切分或六档产品逻辑。
- 用户已有的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 本地改动不属于本轮，提交时必须继续排除。

## 2026-07-25：v4 Phase 1 状态审查

结论：Phase 1 已证明英文 PDF 的完整链路可运行，但尚未达到 v4 产品验收，也不能发布。

保存状态：

- 分支：`feature/v4-hisheng`
- 原型检查点：`4647acd`
- 检查点前测试：116/116 通过
- 未发现密钥、个人 PDF、模型缓存、生成音频、`node_modules`、`dist` 或大文件进入提交

已确认问题：

### P0

1. OCR 状态刷新约每 160ms 重置 180ms debounce，扫描任务会永久饥饿。真实 584 页扫描 PDF 表现为 `enabled=true / running=false / cachedPages=0 / failed=false`。

### P1

1. 页内跳转不取消旧页音频和合成。
2. 前端 abort 不停止 Node 端 ONNX 推理。
3. TTS 与 PDF 服务共用 Node 进程，存在事件循环和 CPU 竞争。
4. `R` 绕过正常可用性与预热入口。
5. native chunks 可直接朗读，但 UI 强制要求 OCR，产品语义冲突。
6. 中文和日文回退英语 voice，不能算已经支持。
7. 当前测试缺少 OCR debounce、页内跳转、硬取消和 Electron 集成覆盖。

发布门禁：

- `package.json`、lock、CHANGELOG 和发布资产仍是 `3.0.0`。
- `npm audit --omit=dev` 报告 `kokoro-js → transformers → sharp` 的 3 个 high，当前没有自动修复版本。
- Node engine 声明与 `undici@8.9.0` 的最低要求不一致。
- 新增 Provider、ONNX 和模型权重许可证尚未进入第三方说明。

本轮决定：

- 先修内部逻辑，不在同一阶段更换模型或处理发布。
- 下一轮 reviewer 必须以 `GOAL.md` 完成线和 `PLAN.md` 的失败测试为依据。

## 2026-07-25：v4 工程整理复核

结论：通过，无 P0/P1/P2。

复核证据：

- `4647acd` 与本地标签 `checkpoint/v4-hisheng-phase1-2026-07-25` 指向同一原型恢复点。
- 第二次提交候选只包含 14 份项目管理、索引、历史说明和调研文档，没有混入业务代码、依赖或发布文件。
- native-first、原生文本不足时附近最多 5 页 OCR、六档朗读契约、child process 硬取消和 `R` 门槛在当前执行文件中一致。
- 旧 PRD、模型草案与 Phase 1 日志都已标出历史性质；根目录执行文件的权威顺序清楚。
- `npm test`：116/116 通过。
- `git diff --cached --check`：通过。
- 14 份相关 Markdown 的本地链接：全部可解析。
- 密钥、个人绝对路径和意外大文件扫描：候选提交无命中；本地 `dist/`、`node_modules/` 和模型缓存仍被忽略。

保留一个 P3：原型恢复点中的两份历史 Markdown 使用行尾双空格作换行，因此 `git show --check 4647acd` 会报告 6 条 trailing whitespace。第二次提交已清理这些行，不改写恢复点。

## 2026-07-21：第二步

结论：代码复核通过。

独立 reviewer 首轮发现两个需要修正的行为：

1. 翻页时旧 OCR 只作废结果，却仍会阻塞新页任务。
2. 换 PDF 的加载间隙里，OCR 按钮可能提前出现。

修正后，OCR provider 通过 `AbortSignal` 立即退出旧的 worker 等待，并在当前页变化时终止旧 worker、创建新 worker。旧结果同时受 signal、request id 和 PDF generation 三层校验，不会写入新会话。OCR 按钮改为只在 PDF 首屏渲染完成后显示。

复验通过：

- `node --check`：`app.mjs`、`ocr-provider.mjs`、`reading-model.mjs`、`server.mjs`
- `sh -n`：`start-reader.sh`、`start-reader.command`
- `git diff --check`
- 阅读模型 27 项断言
- 四语本地 OCR 双模型组合和 `reinitialize()`
- OCR 静态资源与 CSP 的本地 HTTP 检查

## 2026-07-21：语言判定与扫描增强说明

用户实测反馈指出两件事：英文 PDF 可能误显示“字/分”，右侧“文字识别”也没有说明与速度估算的关系。

修正与验证证据：

- 语言证据拆成真实 CJK 字符、数字和英文词。数字仍可计入中文/日文页的“字/分”，但不能触发 CJK 指标。
- 永久回归测试加入英文表格、年份、页码和大量数字，结果稳定判为 `english`。
- 入口改为“扫描页增强估算”，悬停和键盘聚焦时说明适用场景、对估算的作用、本地处理与不改动 PDF。
- 实际载入一份 35 页英文 PDF，原生文本与 OCR 增强后都只显示“词/分”。
- 319 px 窄屏与 1440 × 900 桌面布局通过；状态不再把按钮推离页面，说明气泡与按钮不重叠。
- 浏览器控制台无错误。

独立 reviewer 结论：通过，无 P0–P2 问题。`npm test` 的 5 个测试、34 项断言全部通过；另做聚合级复核，确认英文数字页的 `cjkRate = 0`、真实 CJK 页仍会把数字计入字速，15% + 20 的混排门槛不变。JavaScript、shell 语法与 `git diff --check` 也再次通过。

## 2026-07-22：第三步长文档性能

结论：通过，无 P0–P2 问题。

独立 reviewer 的首轮复核发现：后续当前页渲染失败会静默停在底稿；HTTP Range 诊断缺少请求与字节信息；8 GB + OCR 只剩 6 页缓存；运行中的 PDF 被移动后 `statSync()` 可能逃逸。修正为页内错误与自动暂停、调度稳定态诊断、本地服务 HTTP Range 统计、7 页最低热区，以及文件缺失 404。

第二轮复核发现 File transport 首块预读引入 latest-selection 竞态。最终实现先建立 generation、取消令牌和纸页底稿，再延迟调用 source factory；旧 source 的成功与失败路径都检查 generation 和 signal，晚到结果会被丢弃并中止 transport。隐藏标签期间的当前页失败也会清除自动恢复状态。

真实样本复验还否决了两项看似合理的优化：浏览器自管 HTTP transport 会停在首块；1 MiB Range chunk 会读取完整 262 MB 文件。最终保留 PDF.js 原生 HTTP Range 和 256 KiB chunk。File 路径另以真实 584 页样本验证，只通过 `slice()` 读取 150,531,344 / 262,204,688 字节。

复验通过：

- `npm test`：24/24；
- 全部 `.mjs` 的 `node --check`；
- `start-reader.sh`、`start-reader.command` 的 `sh -n`；
- `git diff --check`；
- 584 页真实样本的首屏、DPR 2、跳页、回看、缓存、缩放锚点、OCR 抢占和 HTTP/File Range；
- 浏览器 warning/error 为 0。

Reviewer 仅保留一个 P3 建议：未来把两次异步 source factory 的后选优先行为抽成可注入的永久竞态测试。
