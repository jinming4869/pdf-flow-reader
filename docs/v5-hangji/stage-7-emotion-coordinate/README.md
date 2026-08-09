# 阶段 7：连续效价 × 唤醒情绪坐标

状态：**本机通过；正式 30/90 秒回流尚未接入**

日期：2026-08-09

基线：`b71e926`（正式套索与草稿留痕）

## 目标

在最小暂停面板中加入由读者本人选择的连续二维情绪坐标，同时保证：

- 不预填中心点；
- 不要求落点后才能返回；
- AI 不参与情绪判断；
- crop 与 emotion 并发写入不会互相覆盖；
- originalEmotion 首次写入后不可变。

## 坐标语义

`emotion-coordinate.mjs`：

- 横轴左到右：负面效价 `-1` → 正面效价 `+1`；
- 纵轴下到上：低唤醒 `-1` → 高唤醒 `+1`；
- 存储值夹紧到 `[-1, 1]` 并保留三位小数；
- marker 在 UI 中使用百分比反投影；
- 附近词只解释坐标，不写入 trace。

初始邻域词：

| 区域 | 解释词 |
| --- | --- |
| 正效价 / 高唤醒 | 振奋、惊喜、兴奋 |
| 负效价 / 高唤醒 | 不安、愤怒、紧张 |
| 正效价 / 低唤醒 | 安宁、满足、舒缓 |
| 负效价 / 低唤醒 | 低落、疲惫、疏离 |
| 中心附近 | 难以命名、复杂、平静 |

词典可以以后替换；连续坐标事实无需迁移。

## 操作

- 点击或拖动情绪平面落点；
- 方向键每次移动 0.05；
- Shift + 方向键每次移动 0.2；
- 未落点时第一次方向键从中心出发但立即移动，不会保存 `(0,0)`；
- 面板提供 aria-valuetext，读出效价、唤醒和邻域词；
- prefers-reduced-motion 下 marker 无 transition。

## Revision 串行化

裁图与情绪可能在同一时刻完成。Controller 使用单条 `traceMutationQueue`：

```text
当前最新 trace revision
→ crop save / crop failure / PLACE_EMOTION / REVISE_EMOTION
→ 更新 latestTrace
→ 下一项读取新的 revision
```

快速拖动或连续方向键会依次执行；crop 完成不会擦掉尚在保存的 optimistic marker。

## Electron 全链路证据

正式 UI smoke：

1. 套索后立即点击情绪平面 75% × 25%；
2. repository 保存 `{ valence: 0.5, arousal: 0.5 }`；
3. emotionState 为 `placed`；
4. UI 显示“振奋 · 惊喜 · 兴奋”；
5. aria-valuetext 读出“效价 0.50，唤醒 0.50”；
6. 按 ArrowLeft；
7. emotionState 变为 `revised`；
8. original 保持 `{0.5, 0.5}`；
9. current 变为 `{0.45, 0.5}`。

同一测试中 cropState 保持 ready，证明并发 mutation queue 没有丢失任一结果。

## 验证

- 情绪纯函数：5 项；
- UI 合约、package 与本地静态服务：通过；
- Electron pointer + keyboard + repository：通过；
- Node 完整回归：347 / 347；
- 套索取消和 v4.1 阅读回归继续通过。

本机视觉截图已交付当前开发会话，不进入 Git。

## 已知边界

1. “回到书流”仍临时直接恢复现有速度；阶段 8 必须替换。
2. 未实现书架中的坐标修正 UI，当前只验证数据契约和暂停面板修正。
3. 邻域词是初始小词典，不代表心理诊断或自动情绪分类。
4. 未落点 trace 仍保留 draft，这是冻结需求而非错误。

## 下一阶段

阶段 8 实现显式回流：短中断约 30 秒，新书或长离开约 90 秒；目标只在当前档位上部，任何手动操作立即取消且不自动复活。
