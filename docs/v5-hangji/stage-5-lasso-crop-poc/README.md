# 阶段 5：套索几何、文字命中与高清裁图 PoC

状态：**本机通过，尚未接入正式阅读 UI**

日期：2026-08-09

基线：`1cf0722`（本地 Trace Repository 与 Electron 安全桥接）

## 目标

在不修改 app.mjs 交互的前提下验证：

- 指针坐标能稳定转成页面归一化坐标；
- 自由路径可以采样、简化、平滑并拒绝无效区域；
- 套索文字命中不会穿过双栏中缝；
- 已渲染 PDF canvas 可以生成带上下文的无损矩形裁图；
- 大画布裁图在本机有明确像素预算和时延证据；
- PNG 可以通过正式 preload / IPC 原子写入 trace 目录并更新 CROP_READY。

## 几何契约

`lasso-geometry.mjs` 提供：

- `normalizePointerToPage`：页面外坐标返回 null，不强行夹入页面；
- `sampleLassoPoint`：按最小距离去重并限制原始点数；
- `prepareLassoPath`：RDP 简化、闭合 Chaikin 平滑、面积检查和最大点数；
- `lassoBounds`：归一化边界；
- `selectLassoText`：多边形与文字 bbox 相交检查，并合并 native / OCR provenance。

v5.0 初始参数：

```text
raw minDistance       0.002
raw maxPoints         2048
simplifyTolerance     0.0015
smoothingIterations   1
minimum normalized area 0.0005
prepared maxPoints    1024
```

这些参数属于可调 PoC 结果，正式 UI 试用时可在不改变数据契约的前提下微调。

## 裁图契约

`trace-crop.mjs`：

1. 从套索归一化边界计算 source canvas 像素矩形；
2. 加入上下文 padding 并在页面边缘夹紧；
3. 保持 source 区域不变，仅按输出像素预算缩放；
4. 在 OffscreenCanvas 或临时 HTMLCanvas 中 drawImage；
5. 输出 PNG Blob 后立即把临时 canvas 缩为 1×1；
6. 支持 AbortSignal；
7. 裁图异步完成，不阻塞回流状态机。

本机 PoC 后将默认输出预算冻结为 **4,000,000 像素**。内部事实源当前只接受 `image/png`，单文件上限 64MB，并检查 PNG 签名。

## Electron 测量

环境：产品所有者本机 macOS、Electron 43.2.0、禁用硬件加速的隐藏测试窗口。

### 旋转 PDF canvas

合成 PDF 页面带 `/Rotate 90`：

```text
source canvas   1880 × 1453
crop output     1176 × 921
PNG bytes       24,804
observed time   24–69ms（不同本机运行）
```

这证明裁图使用 PDF.js 最终 viewport 后的 canvas，旋转已经反映在源尺寸中。

### 大画布

```text
source canvas   3000 × 4000
output          1741 × 2297
output pixels   3,999,077
PNG bytes       1,055,113
estimated source + output RGBA bytes 63,996,308（约 61MiB）
```

最后一组连续 5 次：

```text
P50  69.6ms
P95  70.0ms
max  79.0ms
```

开发过程的不同冷启动运行中观测过约 172ms 最大值，仍低于 200ms 候选线。这里的 61MiB 是像素缓冲理论估算，不是进程实际峰值；真实大型 PDF 仍需后续实机测量。

## 跨进程持久化

正式 product preload 路径已经验证：

```text
renderer PNG Uint8Array
→ 来源受限 IPC
→ repository saveCrop
→ 原子 crop.png
→ trace.json CROP_READY + revision 2
```

Electron smoke 同时制造 stale revision，renderer 收到 `TRACE_REVISION_CONFLICT`，证明二进制路径没有绕过乐观并发。

## 测试证据

- 几何与文字命中：5 项；
- crop plan、默认预算、临时 canvas 释放与取消：7 项；
- repository PNG 原子写与 revision：1 项；
- package / local server module surface：通过；
- Electron crop + saveCrop 全链路：通过；
- Node 完整回归：339 / 339；
- v4.1 书架、PDF 渲染、OCR 与 TTS 回归：通过。

## 已知边界

1. 当前只用合成文字块验证双栏和 OCR provenance，尚未用真实扫描书做套索体验。
2. 当前旋转页是无版权合成 PDF，尚未覆盖复杂裁切框、图片掩码和异常 MediaBox。
3. 当前保存矩形上下文原图；不规则透明派生图不属于 v5.0 内部事实源。
4. 尚无丝带环、墨线轨迹、pointer capture 或暂停界面。
5. 实际 app.mjs 连接后需重新测量输入帧率和 scroll freeze。

## 下一阶段

阶段 6 将显式连接：

```text
L / 丝带环
→ TraceSession ARM
→ 暂停滚动与 TTS、冻结视口
→ pointer path
→ prepareLassoPath + selectLassoText
→ repository createDraft
→ renderLassoCrop + saveCrop
→ 最小暂停界面
```

任何连接都必须保持普通文字选择和现有点句朗读不回退。
