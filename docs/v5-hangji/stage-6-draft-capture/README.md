# 阶段 6：正式套索与草稿留痕接入

状态：**本机通过；情绪与正式回流尚未接入**

日期：2026-08-09

基线：`a0d784e`（套索几何与高清裁图 PoC）

## 用户现在可以做什么

在 Electron 桌面版打开具有稳定 PDF.js fingerprint 的 PDF 后：

1. 点击顶部“航迹”丝带环，或按 `L`；
2. 自动滚动与 TTS 立即停止，视口冻结；
3. 在当前清晰页面绘制墨线；
4. 同页有效路径先原子保存 draft；
5. 从已渲染 canvas 生成 PNG 并原子写入；
6. 显示本机裁图预览和“情绪待落点”；
7. 点击“回到书流”收起面板。

`L → Esc` 会取消套索、解除视口冻结并保持播放暂停，不创建任何 trace。

## 模块边界

新增 `trace-capture-controller.mjs`，负责：

- TraceSession 事件与 effects；
- L / Esc / 右键和 pointer capture；
- SVG 墨线路径；
- 页面冻结；
- 几何准备与双栏文字命中；
- repository createDraft；
- canvas crop 与 saveCrop；
- 最小保存面板与预览 URL 生命周期。

app.mjs 只提供：

- 暂停当前播放；
- 取消 TTS 与点读；
- 当前页 chunks / canvas；
- 当前速度档位；
- 临时返回阅读动作。

app.mjs 不包含套索算法、裁图算法或 repository 细节。

## 文档身份

正式 UI 只使用 PDF.js `pdf.fingerprints` 形成 `pdfjs:<fingerprint>` 内容身份，再通过 `createDocumentId` 生成安全目录 ID。

- 移动、改名不影响 fingerprint 时可继续关联；
- fingerprint 缺失时隐藏航迹入口；
- 不回退到旧的文件名／大小／修改时间指纹；
- 桌面文件路径通过 `webUtils.getPathForFile` 获取并只作为 lastKnownPath。

## UI 与无障碍

- 丝带环是显式按钮，带 `aria-pressed` 与 `L` 提示；
- 状态通过 aria-live 说明武装、取消、保存和裁图失败；
- 墨线使用圆头、圆角和轻微填色；
- 浏览器模式入口隐藏，不伪造 localStorage 留痕；
- prefers-reduced-motion 下关闭相关 transition；
- 页面普通拖动在未武装时仍用于文字选择和点句。

## Electron 全链路证据

真实隐藏 Electron 窗口执行：

```text
点击航迹
→ 4 点 PointerEvent 套索
→ trace draft
→ crop.png
→ trace.json CROP_READY
→ 本机预览
→ 回到书流
```

结果：

- traceCount：1；
- cropState：ready；
- panelState：saved；
- previewVisible：true；
- 绘制/保存期间 aria-pressed=true、viewportFrozen=true；
- 返回后 panelHidden=true、viewportFrozen=false、aria-pressed=false；
- `L → Esc` 前后 traceCount 均为 1；
- 取消后播放按钮显示“继续”，证明保持暂停。

本机截图已交付当前开发会话，不进入 Git。

## 验证

- UI 静态合约：3 项；
- 既有状态机、几何、crop、repository 与 IPC 测试继续通过；
- Node 完整回归：342 / 342；
- Electron UI trace smoke：通过；
- 合成旋转 PDF 渲染与书架回归：通过。

## 已知临时行为

1. “回到书流”目前直接恢复既有速度，只用于阶段 6 本机验收；阶段 8 必须替换为 30 / 90 秒曲线后才可发布。
2. 情绪坐标尚未实现，trace 保持 draft / emotion unplaced。
3. 合成 PDF 在套索时文字缓存尚未 ready，因此 smoke 的 source provenance 为 none；截图和路径不受影响。
4. 本轮压力下 3000×4000 crop 曾出现约 256ms 冷峰值；裁图异步且未阻塞返回，但真实 PDF 仍需持续测量。
5. 尚未提供书架航迹列表或原页回跳。

## 下一阶段

阶段 7 在同一最小面板中加入连续效价 × 唤醒坐标、键盘操作、邻域词解释和 PLACE_EMOTION；未落点仍允许返回。
