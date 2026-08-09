# v5.0.0-beta.2：首轮真实试用修复

状态：**自动化、Electron 与 packaged 验收通过；等待产品所有者复测**

日期：2026-08-09

反馈来源：产品所有者首次试用 `5.0.0-beta.1`

## 反馈与判断

### 1. 为什么使用独立 worktree

独立 worktree 的原意是保护本机主 4.0：

- 原主目录当前位于 `feature/v4-hisheng`；
- 原主目录有一份未提交的研究文档修改；
- 原分支与 v5 分支分别有独有提交，直接覆盖或粗暴 merge 有丢改动风险；
- v5 的阶段门要求每阶段可独立回滚，且私人材料不得进入新分支。

分支对比确认 v5 没有遗漏主 4.0 的核心 TTS 源码；两边的 TTS 主文件基本一致，问题来自共同的原有设计。工作树隔离本身合理，但此前没有提前解释，也没有给出最终收敛到原目录的路径，这是交付流程缺口。

在 beta.2 复测通过前不修改原主目录。通过后应先保护未提交文档，再将原路径受控切换到 v5 分支，最后移除临时 worktree。

### 2. 阅读页无法返回首页

根因：书架和 `showEmptyState()` 已存在，但产品没有“关闭当前书”的状态转换；顶栏“换一份 PDF”只能换书。

修复：

- 顶栏新增明确的“书架”按钮；
- 返回前同步保存当前页与阅读状态；
- 使旧加载 generation 失效并中止待处理文件源；
- 取消 TTS、OCR、套索和回流；
- 销毁 PDF.js document、render scheduler 与 canvas；
- 航迹文件和最近阅读记录保留；
- 返回后把键盘焦点交回书架。

Electron 实测：

```json
{
  "emptyVisible": true,
  "controlsHidden": true,
  "homeButtonDisplayed": false,
  "canvasCount": 0,
  "recentBookCount": 2
}
```

复杂 Prompt 仍按冻结范围属于 v5.2；beta.2 修复的是书架级导航基础，不提前加入在线 AI。

### 3. 最低两档朗读卡顿

最低两档为：

- 雪国朦胧：≤ 8 px/s；
- 美学散步：≤ 14 px/s。

确认的结构问题：

1. warmup 固定用中文“希声”，英文 PDF 被错误标记为 ready；
2. 连续朗读只有一个预取槽，短段无法吸收推理抖动；
3. 当前音频结束后只按阅读线重新选段，已准备的邻近下一段可能继续等待；
4. 美学散步对轻微动态语速变化也丢弃已合成音频；
5. 取消活跃推理会重建 worker，但旧的 ready 标志可能继续存在。

修复：

- 从当前页文本判断 `english` / `multilingual` runtime；
- 中英混排同时预热两个 runtime，实际 warmup 只使用短固定句；
- 最低两档使用最多两个未来段的有界预取；
- N+1 消费时保留 N+2，并补入 N+3；
- 已准备的紧邻下一段距阅读线不超过 0.2 页时直接续播；
- 必须是紧邻段，预取失败时不能越段；
- 美学散步速率漂移不超过 0.2x 时复用音频，大幅变化仍重新合成；
- 硬取消未完成推理后清空 runtime ready 标志，恢复时重新预热。

真实本机 runtime 队列结果：

```json
{
  "zh": {
    "consumeMs": [0.19, 0.02],
    "prefetchUsed": 2,
    "prefetchCompleted": 2,
    "failed": 0
  },
  "en": {
    "consumeMs": [0.12, 0.02],
    "prefetchUsed": 2,
    "prefetchCompleted": 2,
    "failed": 0
  }
}
```

这里的 `consumeMs` 是已经合成的 N+1 / N+2 从队列进入播放层的等待时间。它证明队列不再制造计算等待；最终听感仍需用产品所有者的真实 PDF 复测。

## 验证

- Node：369 / 369；
- Electron integration smoke：通过；
- 返回书架实际点击与资源释放：通过；
- packaged main：版本 5.0.0-beta.2，旋转 PDF 加载通过；
- packaged 中、日、英 TTS：通过；
- packaged 硬取消与 worker 重建：通过；
- packaged 中英文两段队列：通过，0 failed；
- ad-hoc strict codesign：通过；
- ZIP 完整性：通过。

## 候选

```text
night-study-5.0.0-beta.2-mac-arm64-final.zip
SHA-256 23b4f144b4bba314916c1712d2ba878ab33943b860a191688c12740fefc321bf
```

约 374MB；未使用 Developer ID，未公证，未发布 GitHub。

## 复测问题

1. “书架”按钮是否符合直觉，返回后能否继续使用书架功能；
2. 卡顿发生在中文、英文、日文还是扫描页；
3. 是首次开启等待，还是每个段落之间等待；
4. 雪国朦胧与美学散步分别是否连贯；
5. 若仍有停顿，按 `D` 打开诊断时 `prefetchUsed`、`prefetchFailed` 和 `status` 是什么。

## 原主目录收敛门

复测通过并取得明确确认后：

1. 备份原主目录未提交 diff；
2. 保留 `feature/v4-hisheng` 分支作为回滚点；
3. 释放 v5 分支的临时 worktree 占用；
4. 在原 `resources/pdf-flow-reader-workspace/pdf-flow-reader` 路径切换到 v5 分支；
5. 恢复未提交研究文档并检查冲突；
6. 完整回归和本机启动后再删除临时 worktree。
