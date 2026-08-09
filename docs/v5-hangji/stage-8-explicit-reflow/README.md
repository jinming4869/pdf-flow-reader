# 阶段 8：显式 30 / 90 秒回流

状态：**技术路径本机通过；主观体验待真实阅读验收**

日期：2026-08-09

基线：`697745b`（连续情绪坐标）

## 目标

用可取消、永不跨档的速度曲线替换阶段 6 的直接恢复：

- 用户明确按“回到书流”或恢复播放后才开始；
- 短中断约 30 秒；
- 新书、应用恢复或长暂停约 90 秒；
- 任何手动操作立即取消；
- 取消后不自动复活。

## 纯控制器

`reflow-controller.mjs` 提供：

- `reflowTargetForSpeed`：计算当前档位上部但不越过 max 的目标；
- `smoothstep`：有界对称缓动；
- `start`：冻结 start / target / mode / duration；
- `sample`：按绝对时间给出当前速度；
- `cancel`：保存最后速度并终止 generation；
- `snapshot`：提供可诊断状态。

初始 PoC 参数：

```text
short duration       30,000ms
long duration        90,000ms
long pause threshold 10 minutes
upper tier ratio     0.82
```

典型档内目标：

```text
6  → 7   雪国朦胧
16 → 20  长日留痕
24 → 29  流觞曲水
42 → 42  已高于目标，不减速
64 → 64  不制造假曲线
```

## 正式触发

- 套索“回到书流”：按实际套索中断时长选择 short / long；
- 新 PDF 准备完成：long；
- 手动暂停后恢复：按暂停时长；
- 应用从后台恢复：long；
- 从头再读：long。

## 用户控制权

以下行为立即 `cancelReadingReflow`：

- 暂停；
- 滚轮；
- 触摸滚动；
- 拖动滚动条；
- 方向键、PageUp / PageDown、Home / End；
- 调速；
- 隐藏文档；
- 打开另一份 PDF；
- 再次进入套索。

取消只停止入流加速；如果用户没有暂停，原有自动阅读按手动速度继续。界面同步移除“正在回到书流”，不保留错误状态。

## animate 接入

每帧先读取 reflow sample，再交给现有 420ms 速度平滑：

```text
reflow smoothstep speed
→ existing easedSpeed
→ scrollCarry
→ viewport.scrollTop
```

曲线完成后：

- `speed`、range input 与物理速度统一到档内目标；
- 不改变 tier；
- 更新阅读记录；
- 清除 reflow UI 状态。

`lastFlowSpeed` 记录实际阅读速度，套索痕迹不再把暂停后的 0 当作物理速度。

## 测试证据

纯函数测试：

- 各档目标不跨档且不降低已有高速度；
- smoothstep 0 / 0.5 / 1；
- 30 秒中点从 16 到 18，终点 20；
- 新书和十分钟长暂停使用 90 秒；
- 手动取消后 sample 永远返回 null；
- 已在目标速度时不制造假曲线。

Electron smoke：

- 套索返回后 `speedExperience.dataset.motion = reflow`；
- 状态显示“正在回到书流”；
- WheelEvent 后 motion 立即变为 idle；
- 状态文字清空；
- viewport 不冻结；
- 播放保持“暂停”按钮，即仍在阅读而非被系统强制停下。

## 验证

- 回流纯函数：6 项；
- UI / package / server 合约继续通过；
- Node 完整回归将在阶段检查点记录；
- Electron reflow start / cancel smoke：通过。

## 尚需产品所有者验收

自动化只能证明曲线正确，不能证明体验自然。阶段 10 需要真实阅读：

- 30 秒是否太快或太慢；
- 90 秒是否让人重新进入节奏而不无聊；
- 0.82 档内目标是否产生适度挑战；
- 中途夺回控制是否足够直接。

这些参数可以根据体验微调，但不能改变“显式触发、不跨档、手动优先”的冻结原则。

## 下一阶段

阶段 9 实现单书航迹：二维散点、阅读顺序、详情、修正、回收站与原页回跳。
