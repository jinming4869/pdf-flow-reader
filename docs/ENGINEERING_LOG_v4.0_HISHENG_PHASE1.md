# 夜晚的书斋 v4.0「希声」阶段性工程日志：Phase 1

> 状态说明（2026-07-25）：这是 `4647acd` 之前的施工快照，用于追溯已经完成的链路与真实问题，不再承担当前执行计划。后续工作以根目录 `GOAL.md`、`DECISIONS.md` 和 `PLAN.md` 为准。

更新时间：2026-07-25
对应 PRD：`docs/PRD_v4.0_HISHENG_TTS.md`
关联竞品调研：`docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md`
当前主题：本地优先 TTS 随读从原型接入到真实 Electron 场景验证
当前状态：核心链路已跑通，但尚未达到 v4.0 可验收质量

---

## 0. 本日志的用途

这份文档不是发布说明，而是后续继续推进「希声」工程的阶段性施工记录。它用于回答四个问题：

1. 对照 v4.0 PRD，我们已经实现了什么。
2. PRD 目标还剩下什么。
3. 已实现部分在真实测试中暴露了哪些不符合用户需求的新问题。
4. 后续应按怎样的线性流程继续推进，避免在模型、文本结构、UI、性能之间来回打转。

---

## 1. v4.0 PRD 核心目标回顾

PRD 对「希声」的定位是：

> 让当前阅读区域在需要时低声出现，而不是把整份 PDF 念出来。

因此 v4.0 的核心目标不是“全文 TTS”，而是：

1. 本地优先，默认不上传 PDF 文本。
2. 朗读跟随 ReadingClock 与阅读线。
3. 声音低干扰，可随速度档位变密或变疏。
4. 优先支持中文、英文、日文，保留扩展空间。
5. 保留 API TTS provider，但默认路线为本地模型。
6. PDF 阅读不能因 TTS 阻塞自动滚动和渲染。
7. 文本结构必须足够可靠，避免页眉、页脚、脚注、表格、公式、参考文献、双栏错序被错误朗读。

---

## 2. 已实现内容

### 2.1 TTS 模块骨架已建立

已新增并接入以下模块：

```text
tts-provider.mjs
tts-controller.mjs
tts-scheduler.mjs
tts-segment-picker.mjs
tts-preferences.mjs
tts-model-manager.mjs
tts-audio-player.mjs
readable-chunk.mjs
```

对应 PRD §6.1 的模块拆分基本完成。

当前模块职责：

| 模块 | 当前职责 |
| --- | --- |
| `tts-provider.mjs` | Provider 抽象、Kokoro 本地 provider、OpenAI provider skeleton、Null provider |
| `tts-controller.mjs` | 希声模式、速度档位策略、是否可朗读判断 |
| `tts-scheduler.mjs` | 根据当前阅读线选择 chunk、排队、合成、取消、预生成 |
| `tts-segment-picker.mjs` | 根据 reading line 从 chunks 中选择最近可读片段 |
| `tts-preferences.mjs` | TTS 偏好配置与模式切换 |
| `tts-model-manager.mjs` | 模型状态管理骨架 |
| `tts-audio-player.mjs` | Web Audio 播放、停止、静音、音量、ducking 接口 |
| `readable-chunk.mjs` | PDF/OCR 文本转为可朗读 chunk，带角色、优先级、坐标 |

---

### 2.2 Provider 路线：Kokoro ONNX 本地 provider 已跑通

PRD 原本暂定 MeloTTS 为默认本地基线，但实际工程中先采用 Kokoro ONNX 作为轻量本地 provider：

```text
model: onnx-community/Kokoro-82M-ONNX
dtype: q8
provider: kokoro-js
```

选择原因：

1. JS / ONNX 生态更容易直接接入 Electron 项目。
2. 避免 Python / PyTorch sidecar 的打包复杂度。
3. 模型体积较小，适合作为最小可用本地 provider。
4. Apache-2.0，分发风险较低。

已完成：

- `kokoro-js` 依赖接入。
- 本地 Node server 暴露：

```text
GET  /tts/kokoro
POST /tts/kokoro
```

- Renderer 不再直接 import `kokoro-js`，而是通过本地 endpoint 请求合成。
- 支持 voice fallback。
- 支持 speed 参数传入。
- 支持 provider cancel skeleton。
- 支持 Kokoro 预热。

重要现实发现：

当前安装的 Kokoro voice set 实际只有英语 voice：

```text
af_heart, af_alloy, af_aoede, af_bella, af_jessica, af_kore, af_nicole, af_nova, af_river, af_sarah, af_sky,
am_adam, am_echo, am_eric, am_fenrir, am_liam, am_michael, am_onyx, am_puck, am_santa,
bf_emma, bf_isabella, bm_george, bm_lewis, bf_alice, bf_lily, bm_daniel, bm_fable
```

之前设想的中文/日文 voice：

```text
zf_xiaobei
jf_alpha
```

在当前包中不可用。当前 CJK/Japanese fallback 到：

```text
af_heart
```

这意味着：**本地 TTS 链路已跑通，但中文/日文质量目标尚未真正达成。**

---

### 2.3 OpenAI API provider skeleton 已保留

已实现：

- `createOpenAITtsProvider()` skeleton。
- API key 缺失时不会启用。
- provider config 要求 API key 与 consent 同时存在才使用在线 provider。
- OpenAI provider 单元测试已覆盖元信息、取消、key 校验。

未完成：

- 尚未接入真实 API key 实测。
- 尚未做在线 provider UI。
- 尚未做“发送当前朗读片段”的明确授权界面。

符合 PRD 的隐私方向：API provider 目前不会默认工作。

---

### 2.4 希声 UI 与快捷键已接入

已完成：

- 底部低存在感控件：

```text
希声：关 / 低音 / 随读
```

当前代码内部模式为：

```text
off / whisper / flow
```

- 快捷键：

```text
H：切换希声模式
R：读当前句/当前段
Esc：停止朗读
D：打开/刷新 TTS 诊断面板
```

- 默认关闭、默认静音。
- OCR 未开启前隐藏希声控制。
- 最高两档速度隐藏/禁用希声控制。
- 希声启用时，阅读线常驻显示。
- 阅读线视觉已改为长、干净、主题色、无左侧手柄。

---

### 2.5 OCR 解锁 TTS 的产品语义已接入

用户明确修正 OCR 按钮语义后，当前文案方向为：

```text
使用内置OCR功能扫描本文档，以获得更准确的阅读速度估计，并解锁朗读功能。不会上传 PDF。
```

已完成：

- OCR 开启后才显示底部希声控件。
- OCR 开启后可用于补足无 native text 的页面。
- OCR chunks 优先于 native text chunks，但如果 OCR chunks 为空，会回退 native text。
- 当前页无可读 chunk 时，新增当前页优先 OCR 逻辑。
- OCR chunk 生成门槛从：

```js
minChars: 80
maxChars: 360
```

调整为：

```js
minChars: 24
maxChars: 180
```

目的是适配中文书、英文书这类短行、短段页面，避免 OCR 已经扫过但无法形成可朗读 chunk。

---

### 2.6 ReadingClock / 阅读线随读链路已跑通

已完成：

- 根据当前阅读页、阅读线位置、`normalizedReadingY` 选择 chunk。
- `tts-controller` 根据速度档位和模式决定是否朗读。
- `tts-scheduler` 调 provider 合成音频。
- `tts-audio-player` 播放合成结果。
- pause / clear / jump / mode-change / document-change 会取消或重置 TTS。
- late result 通过 generation / cancel 机制避免明显播放旧音频。

真实诊断中已经观察到英文论文可完成完整链路：

```json
"chunkCount": 14,
"currentPick": { ... },
"scheduler.status": "completed",
"audio.status": "playing"
```

---

### 2.7 稀疏朗读规则已重构

PRD 原始表格将六个速度档位都安排了不同密度，但真实测试后发现：

- 最高两档不适合 TTS，声音必然追不上视觉浏览。
- 中间档也不宜连续读，应做“提示型朗读”。
- 最慢档才有可能做相对连续的低声随读。

当前策略：

| 档位 | 当前 TTS 策略 |
| --- | --- |
| 雪国朦胧 | continuous，连续朗读倾向，启用下一段预生成 |
| 美学散步 | soft，柔和点读，可读注释 |
| 长日留痕 | sparse-leads，只读标题/短 lead/段首，不读注释 |
| 流觞曲水 | first-sentence，只读自然段第一句/标题/短 lead |
| 强风吹拂 | 禁用 TTS |
| 万物繁盛 | 禁用 TTS |

新增内容策略：

- 页眉、页脚、边缘短噪声：非手动模式不读。
- `reference` / `table` / `formula`：不读。
- `footnote`：只在最慢两档读。
- `bibliographic` quality flag：不读。
- 含 `doi`、`http(s)`、`www.`、`dataverse`、`replication sets`、`appendix` 的内容会被识别为 bibliographic / footnote / reference 倾向。

---

### 2.8 下一段预生成已实现

为解决“读完一段后等待下一段合成”的问题，`snow-mist` 档新增：

```js
prefetchNext: true
```

实现逻辑：

```text
当前 chunk 合成并播放
→ scheduler 找到下一个符合 TTS 策略的 chunk
→ 后台预生成
→ 下一次阅读线命中该 chunk 时复用缓存
```

诊断字段：

```json
"prefetch": { "key": "...", "ready": true },
"prefetchQueued": 7,
"prefetchCompleted": 7,
"prefetchUsed": 5,
"prefetchFailed": 0
```

真实测试中已经观察到：

```text
prefetchQueued: 7
prefetchCompleted: 7
prefetchUsed: 5
```

说明预生成机制本身已经工作。

---

### 2.9 诊断面板已显著增强

按 `D` 可查看 TTS 全链路状态。

目前诊断包括：

- UI 状态。
- OCR 状态。
- 当前页 chunk 状态。
- controller 模式与档位策略。
- scheduler 队列、结果、prefetch、playback lock。
- audio 播放状态。
- provider 信息。
- self-test。

这个诊断面板已经在真实测试中定位出三类问题：

1. voice 不存在导致 Kokoro 500。
2. OCR chunks 为空导致书籍页无声。
3. 英文论文 native chunks 混入脚注/URL。

---

### 2.10 测试现状

当前全量测试：

```text
116 tests
116 pass
0 fail
```

新增或更新的测试覆盖：

- Kokoro provider 请求 speed。
- Kokoro CJK fallback voice。
- TTS controller 模式与档位。
- 最高两档禁用。
- footnote 只在前两档读。
- first-sentence-only。
- scheduler playback lock。
- scheduler prefetch and reuse。
- readable chunk bibliographic / dataverse / URL 标记。

---

## 3. 对照 PRD：当前完成度评估

### 3.1 基本完成或已跑通

| PRD 目标 | 当前状态 | 备注 |
| --- | --- | --- |
| 默认关闭 TTS | 已完成 | 默认 off / muted |
| 默认本地优先 | 已完成 | Kokoro local endpoint，不默认 API |
| Provider 抽象 | 已完成初版 | Kokoro / OpenAI skeleton / Null |
| ReadingClock 随读 | 已跑通 | 英文论文可选中当前 chunk 并朗读 |
| 希声模式 | 已完成初版 | off / whisper / flow |
| 快捷键 R / Esc / H | 已完成 | D 诊断也已加入 |
| 高速档位稀疏/禁用 | 已完成当前版本 | 最高两档禁用 |
| 跳页/换 PDF/模式切换取消 | 已完成初版 | 仍需更多真实场景压力测试 |
| Web Audio 播放 | 已完成初版 | 支持 muted、volume、stop、duck 接口 |
| OCR 解锁 TTS | 已完成初版 | OCR 开启后显示希声控件 |
| 诊断工具 | 已完成并有效 | 已帮助定位多处问题 |
| 测试基础 | 较充分 | 116 tests pass |

---

### 3.2 部分完成但未达到 PRD 验收质量

| PRD 目标 | 当前状态 | 差距 |
| --- | --- | --- |
| 中文 PDF 可朗读当前阅读线片段 | 链路可跑，但质量不达标 | Kokoro 当前 voice set 无中文 voice；书籍页仍可能 chunkCount=0 |
| 英文 PDF 可朗读当前阅读线片段 | 可跑通 | 双栏论文仍会出现跨栏/脚注/URL 混杂 |
| 日文文本可按需朗读 | 未真正达成 | 当前无日文 voice，fallback 到英语 voice |
| 文本层为空提示 OCR | 部分完成 | OCR 解锁存在，但当前页无 chunk 的提示与补扫刚开始完善 |
| 双栏论文基本不串栏 | 未达标 | 仍出现正文、脚注、跨栏拼接混杂 |
| 表格、公式、参考文献不过度朗读 | 部分完成 | 已有规则，但真实 PDF 还需更多样本压测 |
| TTS 不阻塞滚动和渲染 | 未达标 | 真实测试中加载朗读时鼠标转圈、卡顿 |
| 本地模型管理 | 骨架有，UI 未完成 | 没有首次下载确认、删除模型、模型路径展示 |
| 首次开启提示 | 未完成 | 当前没有 PRD §8.2 的下载确认 UI |
| API provider 明确授权 | 未完成 | skeleton 有，UI 和真实调用未完成 |
| 声音层级 ducking | 只有接口 | 未与 speed cue engine 完整联动 |
| 生成超时跳过 chunk | 未完整实现 | 需要 timeout 策略与 UI 降级 |
| 不保存生成音频 | 基本符合 | 当前只临时内存缓存预生成结果，但需明确生命周期 |

---

### 3.3 尚未开始或基本未完成

| PRD 目标 | 状态 |
| --- | --- |
| MeloTTS / GPT-SoVITS / 中文本地模型 PoC | 未完成 |
| 真正中文/日文高质量 provider | 未完成 |
| 模型首次下载 UI | 未完成 |
| 删除本地 TTS 模型 | 未完成 |
| 模型大小与本地路径显示 | 未完成 |
| 语言模型优先级选择 | 未完成 |
| OpenAI / MiniMax API provider 真实联调 | 未完成 |
| API consent UI | 未完成 |
| 发行说明、许可证说明 | 未完成 |
| 打包后的 TTS 模型路径与分发策略 | 未完成 |

---

## 4. 已暴露但尚未解决的新问题

这些问题不是“还没做的小功能”，而是已实现链路在真实使用中暴露出的产品不达标点。

### 4.1 中文书和英文书出现 `chunkCount = 0`

用户实测中文书：

```json
"chunkCount": 0,
"currentPick": null,
"currentPageHasOcrChunks": false
```

英文书也类似：

```json
"chunkCount": 0,
"currentPick": null,
"currentPageHasOcrChunks": false
```

含义：

- TTS 没有朗读对象。
- OCR 虽然开启，且有 cached pages，但当前阅读页没有 OCR chunks。
- 这会造成“读半页后突然没声”。

已做缓解：

- 当前页无 chunk 时优先 OCR 当前页。
- 降低 OCR chunk 生成门槛。

未解决风险：

- 如果 OCR 识别结果本身为空，仍然无声。
- 如果 OCR 结果有文本但结构化失败，仍然可能 chunkCount=0。
- 当前还没有 UI 明确告诉用户“当前页没有可朗读文本，正在尝试 OCR / OCR 仍失败”。

后续需要：

- 为 current page OCR 失败、OCR 空结果、OCR 有文本但无 chunks 分别做诊断与 UI。
- 记录每页 OCR 原始文本长度、segments 数、chunks 数。

---

### 4.2 Kokoro 当前不满足中文/日文目标

Kokoro local provider 能工作，但当前 voice set 实测只有英语 voice。中文/日文 fallback 到 `af_heart`，这与 PRD 的中文、英文、日文优先支持目标不一致。

影响：

- 中文书即使能形成 chunk，朗读质量也不符合中文阅读需求。
- 日文尚不能算支持。
- 多语言混排只是在 provider 接口层保留了 language hint，没有真正高质量处理。

后续需要：

1. 继续保留 Kokoro 作为英文轻量 fallback。
2. 单独做中文 provider PoC：MeloTTS / GPT-SoVITS / IndexTTS2 外部服务 / Qwen3-TTS 外部服务。
3. 以真实中文书、中文论文、日文短文做样本，而不是只用英文 smoke test。

---

### 4.3 朗读时出现鼠标转圈和卡顿

用户截图和反馈：

```text
加载朗读时鼠标会呈现转圈并卡顿。
```

这直接违反 PRD §10：

```text
PDF 阅读不能因 TTS 阻塞滚动和渲染主线程。
```

可能原因：

1. Kokoro 合成运行在当前 Node server 进程，阻塞 event loop 或占用 CPU。
2. Electron 主进程、local server、renderer 的资源竞争。
3. 预生成虽然减少了下一段等待，但增加了后台合成压力。
4. OCR 与 TTS 同时运行时 CPU 竞争。

后续需要：

- 将 TTS synthesis 从当前 local server 隔离到 worker thread 或 child process。
- 限制同一时刻只能有一个重型任务：OCR / TTS synthesis / prefetch。
- 为 TTS 合成加 timeout 与 backpressure：合成赶不上就跳过，不拖慢滚动。
- 诊断中加入 synthesis wall time、audio duration、RTF、event loop lag。

---

### 4.4 「低音」与「随读」区别不明显

用户反馈：

```text
希声·低音和希声·随读 的区别不明显。
```

当前实现中：

- whisper 和 flow 都会围绕当前 reading line 选 chunk。
- 差异主要体现在密度和手动/自动行为，但 UI 反馈和听感差异不足。

用户需求上的区别应更明确：

| 模式 | 应有语义 |
| --- | --- |
| 低音 / 低声 | 声音偶尔出现，只点亮当前阅读线附近的短句，几乎不追连续 |
| 随读 | 尝试跟随页面流动，在最慢档可更连续，但仍允许跳过 |

后续需要：

- `whisper` 更稀疏，可能只在阅读线进入新段落时读一句。
- `flow` 才启用 prefetch。
- UI 状态文本明确区分：

```text
低声：偶尔读当前短句
随读：尝试接续当前阅读线
```

- 诊断中显示 mode policy，而不只是 mode label。

---

### 4.5 雪国朦胧仍不能长期连读

用户反馈：

```text
雪国朦胧还是没有能实现长期连读，朗读大约半页多之后就没声了。
```

诊断说明：

- 在英文论文中，prefetch 已经工作：`prefetchUsed = 5`。
- 在中文书/英文书中，问题是 `chunkCount = 0`。

因此这不是单一问题，而是两层问题叠加：

1. scheduler 连续接力有一定效果。
2. 但当阅读页没有 chunks 时，scheduler 没有对象可接力。
3. 如果合成速度慢或卡顿，也会让连续感破裂。

后续需要：

- 先保证每个当前阅读页能稳定产生 chunks。
- 再做 prefetch 队列优化。
- 最后再谈“长期连读”的听感。

---

### 4.6 英文双栏论文仍会读乱

用户给出的英文论文诊断中，chunk 文本出现：

```text
believed federalism could help...
*Data replication sets are available in Harvard Dataverse...
```

说明：

- 正文、脚注、URL、数据复制说明混在同一 chunk。
- native text 的双栏顺序和页脚过滤仍不可靠。

已做缓解：

- `dataverse`、`replication sets`、URL、DOI 标记为 bibliographic。
- TTS 层跳过 bibliographic。

未解决：

- 如果正文和脚注已经在同一个 chunk 内混合，事后只靠 role 过滤不够。
- 需要在行级或段落合并阶段阻止混合，而不是在 chunk 已生成后再补救。

后续需要：

- 强化双栏检测。
- 按 bbox 将页脚区、正文区、左右栏分开后再合并。
- 跨区文本不得合并到同一 chunk。

---

### 4.7 真实 OCR 结构化仍不够透明

当前诊断中有：

```json
"cachedPages": 5,
"currentPageHasOcrChunks": false
```

但还不够判断：

- 当前页是否做过 OCR。
- OCR 原始文本长度是多少。
- OCR segments 有多少。
- OCR chunks 为什么为空。
- 是否因为空白页、图片页、识别失败、阈值太高、坐标异常。

已补充：

```json
"currentPageHasOcrText": true/false
```

仍需继续补：

```json
"currentPageOcrTextLength"
"currentPageOcrSegmentCount"
"currentPageOcrChunkCount"
"currentPageOcrLastError"
"currentPageOcrLastRunAt"
```

---

## 5. 后续线性推进流程

后续不要同时乱改 provider、UI、OCR、scheduler。建议严格按下面顺序推进，因为每一步都依赖前一步的稳定性。

---

### Step 1：先把“当前页一定有可解释的文本状态”做稳

目标：无论是否能朗读，系统必须知道当前页处于哪种状态。

需要完成：

1. 扩展 OCR / readable diagnostics：

```json
currentPageNativeTextLength
currentPageNativeChunkCount
currentPageOcrTextLength
currentPageOcrSegmentCount
currentPageOcrChunkCount
currentPageOcrLastError
currentPageReadableSource
```

2. 区分四种状态：

```text
A. native text 可用
B. OCR text 可用
C. OCR 做过但无文本
D. OCR 尚未扫描 / 正在扫描
```

3. UI 对应提示：

```text
正在扫描当前页以解锁朗读
当前页没有可朗读文本
当前页文本结构较差，希声将跳过部分内容
```

验收：

- 中文书滑到无声页时，D 诊断能明确说明为什么无声。
- 不再出现 `chunkCount=0` 但无法判断原因的状态。

---

### Step 2：修 ReadableChunk 管线，优先解决书籍页 chunkCount=0

目标：中文书、英文书的普通正文页应稳定产生 chunks。

需要完成：

1. 对 OCR 结果增加行级 fallback：

```text
如果段落合并失败，至少按 OCR line 生成短 chunk
```

2. 对书籍页建立独立 profile：

```text
单栏、长行、短段、页边距稳定、脚注少
```

3. `minChars` 不应是全局固定值，应按语言和来源调整：

```text
中文 OCR：20–80 字
英文 OCR：8–30 词
日文 OCR：20–80 字符
```

4. 如果当前页 OCR 有文本但 chunk 为空，自动切换 fallback chunker。

验收：

- 中文书正文页 `chunkCount > 0`。
- 英文书正文页 `chunkCount > 0`。
- 页眉页脚不成为主要朗读对象。

---

### Step 3：再修英文双栏论文文本结构

目标：英文论文不串栏，不把脚注/URL 合并进正文 chunk。

需要完成：

1. 在 line 阶段完成区域划分：

```text
title area
left body column
right body column
footnote/footer area
reference area
```

2. 双栏检测：

```text
收集正文行 x center 分布
识别两个稳定 x 区间
左栏从上到下，再右栏从上到下
```

3. 合并约束：

```text
不同 column 不合并
body 和 footnote 不合并
body 和 bibliographic 不合并
页脚区不合并进正文区
```

4. 增加双栏论文 fixture 测试。

验收：

- 英文论文正文 chunk 不混入 Dataverse / DOI / URL 脚注。
- 双栏顺序基本正确。
- D 诊断中的 currentPick 文本读起来像自然段，而不是碎片拼接。

---

### Step 4：隔离 TTS 合成，解决卡顿

目标：TTS 不能让鼠标转圈，不能拖慢滚动和渲染。

需要完成：

1. 将 Kokoro synthesis 从当前 server 主事件循环移到：

```text
worker_threads
或 child_process
```

推荐优先：`child_process`。理由：ONNX runtime 在 macOS standalone smoke test 中曾出现退出时 mutex crash，进程隔离更安全。

2. 加入合成队列 backpressure：

```text
正在合成当前段时，不再启动新的重型合成
prefetch 只能在 CPU 空闲或当前播放音频足够长时启动
```

3. 加入 timeout：

```text
如果预计无法在音频时长内完成，跳过当前 chunk
```

4. 诊断增加：

```json
synthesisStartedAt
synthesisDurationMs
audioDurationMs
rtf
eventLoopLagMs
workerBusy
```

验收：

- 启动朗读时鼠标不再持续转圈。
- 自动滚动不明显卡顿。
- 合成慢时宁愿跳过，也不阻塞阅读。

---

### Step 5：明确“低声”和“随读”的产品差异

目标：用户能明显感知两个模式不同。

建议定义：

| 模式 | 行为 |
| --- | --- |
| 低声 | 只读当前阅读线附近短句；每个段落最多读一次；不 prefetch；更像提示 |
| 随读 | 最慢档尝试连续；可 prefetch；其他档稀疏跟随 |

需要完成：

1. `whisper` 禁用 prefetch。
2. `whisper` 增加 cooldown。
3. `whisper` 只读 heading / first sentence / short lead。
4. `flow` 在 snow-mist 才做连续接力。
5. UI 文案区分：

```text
希声低声：偶尔读当前短句
希声随读：尝试接续阅读线
```

验收：

- 用户在同一速度档位下能听出低声与随读差别。
- 低声不造成持续声音占据。

---

### Step 6：重做中文/日文本地 provider PoC

目标：满足 PRD 的中文、英文、日文优先语言目标。

当前 Kokoro 可继续作为英文轻量 provider，但不能作为中文/日文最终答案。

候选路线：

1. MeloTTS：符合 PRD 原方案，但需要 Python sidecar。
2. GPT-SoVITS：中文生态强，但 reference audio / sidecar 复杂。
3. IndexTTS2：中文质量可能好，但许可证和依赖更复杂。
4. Qwen3-TTS：多语言强，但模型重，更适合作外部 localhost provider。
5. MiniMax / OpenAI：API fallback，必须明确授权。

PoC 样本必须包含：

```text
中文书普通正文
中文论文段落
英文书段落
英文双栏论文段落
日文短段
中英混排段落
```

验收指标：

- 短 chunk 合成时间 < 音频时长。
- 中文自然，至少不明显英语腔 fallback。
- 日文可接受。
- 取消稳定。
- 不拖慢滚动。

---

### Step 7：完善模型管理与隐私 UI

目标：满足 PRD §5.6、§8.2、§9。

需要完成：

1. 首次开启本地希声提示：

```text
希声会在本机下载语音模型，并只朗读当前阅读片段。PDF 文本不会默认上传。
```

按钮：

```text
下载本地模型
稍后再说
```

2. 模型状态：

```text
正在准备本地语音模型
正在下载本地语音模型
模型加载失败，希声已回到静默
```

3. 模型管理：

```text
查看模型路径
查看模型大小
删除本地模型
```

4. API provider consent：

```text
开启在线希声后，当前朗读片段会发送给所选 TTS 服务商。
```

验收：

- 默认不发送文本。
- API 未开启时不会发起 TTS 网络请求。
- 用户能删除本地模型。

---

### Step 8：声音层级打磨与发布准备

目标：进入 v4.0 可验收体验。

需要完成：

1. TTS 与 speed cue ducking：

```text
TTS 播放时，切档音效降到 30%–50%
```

2. 跳页/停止淡出无爆音。
3. README v4.0 更新。
4. 模型许可证说明。
5. Release notes。
6. 打包测试。

---

## 6. 下一次继续工作时的推荐起点

建议下一次不要从 provider 开始，而是先从文本状态和 chunk 稳定性开始。

最推荐的第一任务：

```text
扩展 D 诊断：为当前页显示 native text length、native chunk count、OCR text length、OCR segment count、OCR chunk count、OCR last error。
```

原因：

- 当前最严重的用户问题是“读着读着没声”。
- 没声可能来自 OCR 未扫、OCR 空、chunk 为空、scheduler 策略跳过、provider 卡顿。
- 没有更细的诊断，就会继续靠猜。

推荐提交顺序：

```text
1. current page text/chunk diagnostics
2. OCR line fallback chunker
3. book-page chunkCount=0 regression tests
4. double-column line-region splitter
5. TTS synthesis child process isolation
6. whisper vs flow behavior split
7. Chinese/Japanese provider PoC
8. model/privacy UI
```

---

## 7. 当前文件变更索引

本阶段重点涉及：

```text
app.mjs
server.mjs
storage.mjs
index.html
styles.css
package.json
package-lock.json
readable-chunk.mjs
tts-provider.mjs
tts-controller.mjs
tts-scheduler.mjs
tts-segment-picker.mjs
tts-audio-player.mjs
tts-model-manager.mjs
tts-preferences.mjs
scripts/proxy-bootstrap.mjs
scripts/kokoro-smoke.mjs
tests/readable-chunk.test.mjs
tests/tts-provider.test.mjs
tests/tts-controller.test.mjs
tests/tts-scheduler.test.mjs
tests/tts-audio-player.test.mjs
tests/tts-model-manager.test.mjs
tests/tts-preferences.test.mjs
tests/server-range.test.mjs
```

当前测试基线：

```text
npm test
116 tests
116 pass
0 fail
```

---

## 8. 一句话判断

v4.0「希声」现在已经从“概念与接口”进入“真实 PDF 中能发声”的阶段，但还没有达到“可长期安静随读”的产品质量。当前首要矛盾不是再增加模式，而是把三件底层事情做稳：

```text
当前页必须有可靠 chunks；
TTS 合成不能卡住阅读；
中文/日文 provider 必须真正可用。
```
