# 阶段 9：单书情绪航迹

状态：**本机通过；待阶段 10 真实 PDF 与打包验收**

日期：2026-08-09

基线：`5cac1bb`（显式 30 / 90 秒回流）

## 目标

完成 v5.0 离线核心的“回看”一环：

- 连续效价 × 唤醒散点；
- 按 readingOrder 连线；
- 未落点 trace 保留在列表但不伪造坐标；
- crop 截图与文字详情；
- 书架中修正 currentEmotion；
- 保留 originalEmotion；
- 当前书原页回跳；
- 30 天回收站与恢复。

## 安全 crop 读取

Repository 新增 `readCrop(documentId, traceId)`：

- 只有 trace.crop 为 ready 时读取；
- 只读取固定 trace 目录内的 crop.png；
- 通过来源受限 IPC 和正式 preload 返回 Uint8Array；
- renderer 用 Blob URL 显示并在切换/关闭时 revoke；
- 不开放任意路径读取。

## 单书 Controller

`trace-book-controller.mjs` 独立负责：

- 顶栏“航迹图”入口；
- 单书 panel 打开/关闭；
- 600×360 情绪坐标图；
- readingOrder polyline；
- 可键盘聚焦的 SVG 点；
- 横向 trace 列表；
- crop、页码、档位、物理速度、文字与最初坐标详情；
- 连续情绪修正；
- active / trash 两种视图；
- TRASH / RESTORE；
- 调用 app.mjs 的原页回跳回调。

app.mjs 只设置当前 trace document、暂停阅读和执行 `jumpToTracePage`，不包含图表算法。

## 文档映射

PDF 注册成功后，最近阅读记录补充：

```text
traceDocumentId
traceFingerprint
```

当前打开的 PDF 可直接跳回原页。若航迹所属 PDF 未打开或内容身份不匹配，应用提示重新选择原 PDF，而不按文件名猜测关联。

## Electron 全链路证据

在阶段 7 产生的一条真实本地 trace 上：

1. 打开单书航迹 panel；
2. 图表显示 1 个情绪点、列表显示 1 项；
3. crop 图片读取并显示；
4. 书架情绪平面修正 current 为 `{-0.5, -0.5}`；
5. original 保持 `{0.5, 0.5}`；
6. 邻域词变为“低落 · 疲惫 · 疏离”；
7. 点击“回到原页”，状态显示“已回到第 1 页”；
8. 重新打开并移入回收站；
9. 切换回收站视图，按钮显示“恢复航迹”；
10. 恢复后 active 列表重新显示 1 项。

最终 smoke 状态没有遗留 trashed 记录。

## 验证

- crop read repository / IPC / preload / client：通过；
- 单书 UI 静态合约：3 项；
- package 与本地静态模块 surface：通过；
- Electron 图表、详情、修正、回跳、trash、restore：通过；
- Node 完整回归：356 / 356；
- 本机视觉截图已交付当前开发会话，不进入 Git。

## 已知边界

1. 当前顶栏入口服务正在阅读的书；空书架历史书需要先重选 PDF 才能回跳。
2. smoke 只有一个点，尚未验证 40+ 点重叠、过滤和大列表性能。
3. 当前图表按 readingOrder 连线，尚未增加页码/时间/档位筛选控件。
4. 坐标修正后只更新本地事实源；未来归档状态将标记 stale，不自动改外部内容。
5. 彻底 purge 没有 UI，只由 30 天到期清理或未来二次确认入口执行。

## 下一阶段

阶段 10：

- 选择真实普通文字、双栏、扫描、旋转和大型 PDF；
- 产品所有者主观验收 30 / 90 秒回流；
- 本机 macOS 打包；
- 完整离线端到端；
- 迁移与重启；
- 生成可在产品所有者电脑上运行的 v5.0 候选包。
