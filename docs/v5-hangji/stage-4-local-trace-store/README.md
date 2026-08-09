# 阶段 4：本地 Trace Repository 与 Electron 安全桥接

状态：**本机通过，尚未接入套索 UI**

日期：2026-08-09

基线：`95f4a4a`（ReadingTrace 契约与套索会话状态机）

## 目标

把阶段 3 的纯数据契约变成真正的本地事实源，同时保持 renderer 无任意文件系统权限、普通浏览器无伪造持久化 fallback、v4.1 阅读行为不变。

## 数据布局

```text
<userData>/reading-traces/
  documents/<document-id>/
    document.json
    traces/<trace-id>/
      trace.json
  recovery/
```

当前阶段只持久化文档索引与 trace JSON；crop 二进制由阶段 5 PoC 和后续接入补充。

## Repository 能力

`trace-repository.mjs` 提供：

- 初始化可检查目录；
- 注册文档身份、显示名、大小与最近路径；
- 同一 documentId 的 fingerprint 不匹配时拒绝覆盖；
- 原子创建草稿；
- 读取与按 readingOrder 列表；
- 通过 expectedRevision 进行乐观并发控制；
- 执行 ReadingTrace 生命周期事件；
- 隐藏 trashed 记录并支持恢复；
- 到期后明确 PURGE 并删除目录；
- 移除孤儿临时文件；
- 将损坏的 document.json 或 trace.json 移入 recovery，而非覆盖或静默清空。

### 原子写入

每个 JSON 写入流程：

```text
同目录创建 0600 临时文件
→ 写入完整 JSON
→ fsync 文件
→ 关闭
→ 原子 rename 为正式文件
```

同一文档的写操作进入串行 Promise 队列。业务错误会返回给调用方，但内部队列尾始终 settle，后续写入不会因一次失败永久阻塞。

### readingOrder

- `document.json` 保存 `nextReadingOrder`；
- 创建前同时扫描已有痕迹最大序号；
- 采用两者较大值，防止损坏或崩溃后的计数器回退制造重复；
- 先推进计数器，再写 trace；失败最多产生空洞，符合 D40，不会重复或重编号。

## Electron 边界

### 正式 preload

`electron-preload.cjs` 只暴露 `window.nightStudyTrace`：

- capabilities
- registerDocument
- createDraft
- readTrace
- listTraces
- transitionTrace
- pathForFile

不暴露原始 ipcRenderer，不提供任意路径读写。

### IPC

`trace-ipc.mjs`：

- 只注册固定 allowlist channel；
- 只接受 `http://127.0.0.1:<port>/` 本地 reader renderer；
- repository 业务结果使用 `{ ok, value }` 或 `{ ok: false, error }` 信封；
- 错误只公开稳定 code 与 message，不传 stack；
- 不可信来源在信封外直接拒绝。

### Renderer client

`trace-client.mjs` 在主世界解包信封并重建带 code 的 Error。普通浏览器返回 `available: false`，不使用 IndexedDB 或 localStorage 假装桌面事实源。

### 主进程

`electron-main.mjs` 在 app ready 后：

1. 以 `<userData>/reading-traces` 初始化 repository；
2. 执行 recovery；
3. 清理超过 30 天的回收站记录；
4. 注册 IPC；
5. BrowserWindow 使用正式 preload。

repository 初始化失败只禁用航迹持久化并记录错误，基础 PDF 阅读仍可启动。

## 测试证据

阶段 4 新增或扩展：

- 文档注册与路径更新；
- fingerprint mismatch；
- 并发创建 5 条 trace 的单调 readingOrder；
- 计数器回退时不重复序号；
- revision conflict；
- 临时文件清理；
- 损坏 trace 与 document quarantine；
- trash、restore、到期 purge；
- 路径型恶意 ID 拒绝；
- IPC allowlist、dispose 与不可信来源拒绝；
- 正式 preload 最小 surface；
- renderer client 成功、业务错误与浏览器降级；
- repository / preload 不经本地 HTTP 暴露。

验证结果：

- Node 完整回归：326 / 326；
- Electron smoke：通过；
- product preload 实际创建并更新 trace；
- capabilities 显示 schema 1、原子文件系统、无浏览器 fallback；
- 跨 contextBridge 收到 `TRACE_REVISION_CONFLICT`；
- 合成 PDF 渲染与 v4.1 书架回归保持通过。

## 已知边界

1. `documentFingerprint` 仍由调用方提供；真正的 PDF 内容身份算法与迁移在后续 PoC 确定。
2. crop 图片尚未写入 repository；当前只支持 crop state 和安全相对 reference。
3. v1 没有旧 trace 数据需要迁移；未来 schema 变化必须增加显式 migrator，不得猜测。
4. app.mjs 尚未实例化 trace client，也没有套索入口。
5. Electron 无头退出偶尔输出非致命 SharedImage mailbox 日志；结果与退出码正常。

## 下一阶段

阶段 5 独立验证套索几何、路径平滑、区域文字命中、高 DPR 裁图、旋转页与内存成本。PoC 通过前不接入正式阅读界面。
