# 复核记录

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
