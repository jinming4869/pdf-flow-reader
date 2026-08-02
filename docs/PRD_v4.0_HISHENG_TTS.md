# 夜晚的书斋 v4.0 PRD：希声（历史初稿）

> **历史状态：部分失效。** 本文保留 v4 的产品背景、原则与早期需求。正文中的 MeloTTS / GPT-SoVITS 候选结论、在线 Provider 设计、三态模式、速度密度表、模型首次下载策略和开发顺序均未成为 v4.0.0 的最终实现。正式版本采用六档策略、英文 Kokoro q8、中日文 Kokoro v1.0 int8、自包含 CJK worker，并将模型随桌面包离线提供。当前事实以根目录 [`README.md`](../README.md)、[`CHANGELOG.md`](../CHANGELOG.md)、[`DECISIONS.md`](../DECISIONS.md) 和 [`v4-hisheng/`](./v4-hisheng/) 文档为准。

更新时间：2026-07-24
目标版本：v4.0.0
关键词：希声
核心能力：本地优先 TTS 随读

## 1. 背景

v3.0「回声」已经完成阅读记忆、节奏仪表、六档视觉背景与切档音效。它解决的是“阅读节奏如何被看见、被记住、被轻轻反馈”。

v4.0「希声」要解决的是另一件事：当 PDF 自动流动时，声音如何贴着阅读线出现，而不把阅读器变成一个传统语音播放器。

「希声」的产品原则：

> 最好的朗读，不是持续占据注意力的声音，而是让阅读更安静、更顺滑的声音。

因此，v4.0 的目标不是“把整份 PDF 念出来”，而是“让当前阅读区域在需要时低声出现”。

## 2. 目标

### 2.1 产品目标

1. 在本地部署 TTS 模型，默认不上传 PDF 文本。
2. 朗读跟随 ReadingClock 与阅读线，而不是从第一页开始机械播放。
3. 声音保持低干扰：可稀疏、可取消、可随速度档位变密或变疏。
4. 支持中文、英文、日文为优先语言，保留更多语言扩展空间。
5. 保留 API TTS provider 扩展点，但 v4.0 默认路线为本地模型。

### 2.2 非目标

v4.0 不做：

- iPad 版本
- Zotero 集成
- 云同步
- 全文音频导出
- 播客式长音频生成
- 复杂批注 / PDF 编辑
- 逐词高亮强同步
- 以音色克隆为核心卖点
- 默认在线 TTS

## 3. 目标用户与场景

### 3.1 目标用户

- 长时间阅读论文、报告、书稿的用户
- 希望减少眼睛疲劳，但仍以视觉阅读为主的用户
- 需要中英文、中文、日文材料混合阅读的用户
- 重视本地隐私、不希望 PDF 内容默认发送到云端的用户

### 3.2 核心场景

1. 用户打开 PDF，进入自动滚动阅读。
2. 用户开启“希声：低声”。
3. 阅读线经过当前段落时，系统只朗读附近的短句或短段。
4. 用户暂停滚动，朗读暂停或停止。
5. 用户跳页或换 PDF，旧朗读立即取消。
6. 用户调快速度，朗读自动变稀疏，避免追不上视觉阅读。

## 4. 模型调研与推荐

调研范围包括 Hugging Face text-to-speech 热门模型与轻量本地模型。评价标准为：

- 体积是否可接受
- 是否能本地运行
- 首包延迟与推理速度
- 中文、英文、日文支持
- 部署复杂度
- 许可证与分发风险
- 是否适合“低干扰随读”，而非音色克隆或长音频生成

### 4.1 候选模型对比

| 模型 | 优点 | 问题 | 判断 |
| --- | --- | --- | --- |
| **MeloTTS** | MIT；中文支持中英混读；支持英文、西语、法语、中文、日文、韩文；官方说明 CPU 足够实时推理；单语言 checkpoint 约 208MB | 多语言不是单一模型，需按语言加载；需要 Python/PyTorch sidecar；打包复杂度高于纯 JS | **v4.0 默认本地基线候选**，适合先跑通“固定音色、低干扰随读” |
| **GPT-SoVITS** | MIT；社区成熟；支持中文、英文、日文、韩文、粤语；有 REST API 和 streaming；官方 README 给出 M4 CPU 可用的 RTF 参考；中文生态强 | 偏 few-shot / zero-shot voice cloning，需要 reference audio 或内置默认参考音；工程依赖较重；功能重心容易滑向“玩音色” | **v4.0 本地高质量候选**，建议作为 MeloTTS 的强竞争方案做 PoC |
| **IndexTTS / IndexTTS2** | 工业级中英文 TTS；IndexTTS2 强调情绪、时长控制、zero-shot；中文能力和稳定性值得重视；支持 streaming 返回 | Bilibili 自定义模型许可证；依赖较重，涉及 Qwen/BigVGAN/w2v-bert 等组件；更偏声音控制和克隆，超过“希声”最小需求 | **高级本地 Provider 候选**，不建议作为首个默认内置模型 |
| **Kokoro-82M / ONNX** | Apache-2.0；82M 参数；ONNX / JS 生态较友好；英文质量和速度很好；支持多语言 voice | 中文 voice 训练量和质量等级偏弱；短句和超长句有已知表现问题 | 适合作为轻量实验 provider 或英文优先 fallback |
| **Piper / Piper-plus** | ONNX；极快；模型小；MIT；适合本地和边缘设备 | 原版 Piper 多为单语音色；中文与跨语言质量不稳定；piper-plus 较新，生态成熟度需验证 | 适合作为性能实验路线，不作为 v4.0 默认 |
| **Supertonic 3** | 99M 参数；ONNX；CPU；31 语言；约 400MB 首次下载；速度很强 | 官方语言列表不含中文；OpenRAIL-M；上游已提示将归档，长期维护有风险 | 如果未来不要求中文可重点考虑；v4.0 不适合作默认 |
| **Qwen3-TTS 0.6B** | Apache-2.0；支持中英日韩德法俄葡西意；流式低延迟设计；中文能力预期强 | 模型与 speech tokenizer 合计约 2.5GB；示例偏 CUDA / bf16 / flash attention；本地桌面分发偏重 | 保留为高级 / 外部本地服务 provider，不作为默认内置 |
| **Chatterbox Multilingual V3** | MIT；23+ 语言；质量强；0.5B；多语言泛化好 | 实际权重组合数 GB 级；偏 GPU；音色克隆和表达控制能力超过当前需求 | 不适合作 v4.0 默认，可作为外部 provider |
| **VibeVoice Realtime 0.5B** | MIT；实时流式；首音约 300ms；长文本能力强 | 主要面向英文，其他语言不稳定；模型结构较复杂 | 不符合中文/日文优先需求 |
| **MiniMax Speech 2.8 / Speech-02 API** | 云端质量很强；中文、多语言、情绪和低延迟表现突出；官方文档列出 40 语言、HD/Turbo、流式、PCM/WAV/MP3 等能力 | 不是本地模型；需要 API key、联网、费用和隐私确认；不符合默认本地优先 | **首选云端 API Provider 候选**，适合用户明确同意上传片段时启用 |
| **OpenAI gpt-4o-mini-tts / tts-1 / tts-1-hd API** | API 稳定；支持流式；`gpt-4o-mini-tts` 可用 instructions 控制语气、速度、语调；多语言可用；集成成本低 | 不是本地模型；官方声音仍偏英语优化；需要费用、联网和 AI 语音披露 | **通用 API Provider 候选**，适合英文和快速 fallback |
| **Coqui XTTS-v2 / F5-TTS / Fish / Spark 等** | 质量或克隆能力强 | 许可证、体积、GPU、克隆导向或非商用限制等问题较多 | 暂不进入 v4.0 主线 |

### 4.2 推荐结论

v4.0 推荐采用三层策略：

#### A 层：默认本地基线 Provider：MeloTTS 或 GPT-SoVITS 二选一 PoC

先不要直接拍板。v4.0 第一阶段应做同一批阅读样本的 PoC：中文论文段落、英文双栏论文段落、中英混排段落、日文短段。

MeloTTS 的优势是轻、固定音色、MIT、CPU 友好、没有 voice cloning 心智负担，符合“希声”的克制原则。GPT-SoVITS 的优势是中文生态强、成熟度高、REST/streaming 现成、M4 CPU 也有可用速度参考。二者的取舍应由真实阅读样本的延迟、清晰度、部署复杂度决定。

PoC 后的判断标准：

1. 已下载模型后，短 chunk 生成延迟是否小于音频时长。
2. 中文、中英混排、英文论文段落是否清楚稳定。
3. 是否需要用户提供 reference audio；如果需要，能否内置合法默认参考音。
4. sidecar 打包体积和依赖是否可控。
5. 取消、跳页、连续短句生成是否稳定。

#### B 层：高级本地 Provider：IndexTTS2 / Qwen3-TTS

这类模型更强，但不适合作为 v4.0 默认内置，因为它们更重、更偏声音控制或克隆，且 IndexTTS2 有自定义许可证。它们适合设计成“外部本地服务 provider”：用户自行部署服务，夜晚的书斋只调用 localhost endpoint。

#### C 层：云端 API Provider：MiniMax 优先，OpenAI 备选

如果用户明确接受当前朗读片段上传，MiniMax 是中文和多语言高质量优先候选；OpenAI 是通用、稳定、易集成的备选。两者都必须放在明确授权之后，不能成为默认路径。

API Provider 的 UI 应只说清楚一件事：

```text
开启在线希声后，当前朗读片段会发送给所选 TTS 服务商。
```

#### 下载与部署策略

- 不随 app 初始包内置大型模型。
- 用户首次开启本地“希声”时提示下载模型。
- 模型放在应用数据目录：`~/Library/Application Support/夜晚的书斋/models/tts/` 或跨平台等价目录。
- 本地 sidecar 与 API provider 使用同一个 `TtsProvider` 接口，避免主逻辑分叉。
- v4.0 的正确顺序是：先做 ReadableChunk，再做 Provider PoC，最后接 UI。

## 5. 产品功能需求

### 5.1 希声模式

控制项：

```text
希声：关 / 低声 / 随读
```

默认：关。

说明：

- 关：不运行 TTS。
- 低声：只读阅读线附近的短句或短段。
- 随读：尝试连续跟随页面流动，但仍允许稀疏和停顿。

### 5.2 阅读线随读

基于现有：

- `TextSegment`
- `ReadingClock`

新增：

- 将 PDF.js textContent 转为更稳定的 `ReadableChunk`。
- 根据 `readingLineY` 找到当前 chunk。
- 只朗读当前阅读区域附近内容。

`ReadableChunk` 草案：

```js
{
  documentId,
  pageIndex,
  chunkIndex,
  text,
  languageHint,
  yStart,
  yEnd,
  xStart,
  xEnd,
  sourceSegmentIds,
  role, // body | heading | footnote | header | footer | table | unknown
  priority,
}
```

### 5.3 稀疏朗读规则

声音密度随速度档位变化：

| 速度档位 | TTS 行为 |
| --- | --- |
| 雪国朦胧 | 可完整读当前短段，停顿较长 |
| 美学散步 | 可完整读当前短段，轻声 |
| 长日留痕 | 正常短段随读 |
| 流觞曲水 | 只读短句，跳过过长段落 |
| 强风吹拂 | 段首 / 标题 / 短句优先，显著稀疏 |
| 万物繁盛 | 默认不连续朗读，只保留用户主动“读当前句” |

### 5.4 取消与同步

必须支持：

- 暂停滚动时停止或暂停朗读。
- 恢复滚动时从当前阅读线重新选择 chunk。
- 跳页时取消旧队列。
- 换 PDF 时 hard reset。
- 改变希声模式时取消旧 generation。
- TTS 生成迟到时不播放过期音频。

实现建议：

```text
ttsGenerationId++
queue.clear()
provider.cancel()
currentChunkId = null
```

### 5.5 主动读当前句

快捷动作：

```text
R：读当前句 / 当前短段
Esc：止声
H：切换 希声 关/低声/随读
```

UI 上不堆按钮。快捷键可在帮助文案中说明。

### 5.6 模型管理

最小能力：

- 检测本地模型是否已下载。
- 首次开启时提示下载。
- 显示模型大小和本地路径。
- 支持删除本地 TTS 模型。
- 支持选择语言模型优先级。

文案原则：

```text
希声模型只保存在本机。删除模型不会删除阅读记录或 PDF。
```

### 5.7 API Provider 预留

v4.0 可只做接口与隐藏配置，不默认展示复杂在线设置。

接口形态：

```js
{
  id,
  name,
  mode: "local" | "api",
  languages,
  async synthesize({ text, language, voice, rate, volume, signal }) {
    return { audioBuffer, durationMs, providerMeta };
  },
  cancel()
}
```

API Provider 必须满足：

- 用户明确开启。
- 明确说明会发送当前朗读片段。
- API key 存储在本机。
- 网络失败时自动降级，不影响 PDF 阅读。

## 6. 技术架构

### 6.1 新增模块

```text
tts-provider.mjs
tts-controller.mjs
tts-scheduler.mjs
tts-segment-picker.mjs
tts-preferences.mjs
tts-model-manager.mjs
readable-chunk.mjs
```

### 6.2 Provider 分层

```text
TtsProvider
├── MeloLocalProvider       // v4.0 默认
├── KokoroOnnxProvider      // 实验 / fallback
├── ApiTtsProvider          // 预留
└── NullTtsProvider         // 默认关闭
```

### 6.3 Sidecar 服务

由于 MeloTTS 基于 Python/PyTorch，建议采用本地 sidecar：

```text
Electron main process
→ 启动 tts-sidecar Python 进程
→ localhost 随机端口或 stdio RPC
→ 前端通过 app 内桥接调用
```

优先方案：stdio RPC。理由：

- 不增加额外 HTTP 端口。
- 生命周期可由 Electron main 控制。
- 更容易做取消、退出和日志收集。

备选方案：本地 HTTP 服务。理由：调试容易，但需要端口管理。

### 6.4 音频播放

建议由前端统一播放音频：

```text
Provider 生成 wav/pcm
→ tts-scheduler 收到 ArrayBuffer
→ Web Audio 播放
→ 与现有 sound-engine 做 ducking
```

Ducking 规则：

- TTS 正在播放时，切档音效降低到 30%–50%。
- 切档音效不打断 TTS。
- 跳页 / 停止时允许一个极短淡出，不出现爆音。

## 7. 文本结构处理

### 7.1 必做

- 行合并：按 y 坐标聚类。
- 行内排序：按 x 坐标排序。
- 段落合并：相邻行间距接近且缩进相近。
- 句子切分：中文按 `。！？；`，英文按 `.?!;`，日文按 `。！？`。
- 页眉页脚过滤：重复出现且位于页顶/页底的短文本降低 priority。
- 表格和公式降权：过多数字、符号、短碎片的 chunk 默认不读。

### 7.2 双栏论文

v4.0 必须做初步双栏检测，否则英文论文容易读乱。

简单策略：

1. 收集正文行的 x 中心分布。
2. 如果出现两个稳定 x 区间，判定双栏。
3. 阅读顺序：左栏从上到下，再右栏从上到下。
4. 标题和跨栏大块文本优先作为独立 chunk。

### 7.3 chunk 长度

推荐：

- 中文：20–80 字。
- 英文：8–30 词。
- 日文：20–80 字符。
- 少于 10 个中文字符或 5 个英文词的短句，可与下一句合并。
- 超长句应切分，避免 TTS 迟到和取消困难。

## 8. UI / 交互

### 8.1 控制栏

不做大播放器。只增加一个小型状态控件：

```text
希声：关 / 低声 / 随读
```

状态文本示例：

```text
希声静默
希声低声读当前段
希声随页面流动
正在准备本地语音模型
正在下载中文语音模型
```

### 8.2 首次开启提示

示例文案：

```text
希声会在本机下载语音模型，并只朗读当前阅读片段。PDF 文本不会默认上传。
```

按钮：

```text
下载本地模型
稍后再说
```

### 8.3 错误降级

- 模型未下载：提示下载。
- 模型加载失败：回到静默。
- 生成超时：跳过当前 chunk。
- 文本层为空：提示“当前页没有可朗读文本，可尝试 OCR 后再读”。

## 9. 隐私与安全

1. 默认不启用 TTS。
2. 默认使用本地模型。
3. 本地模型只处理当前朗读 chunk，不处理整份 PDF。
4. API 模式必须单独确认。
5. API 模式必须说明发送范围：当前朗读片段。
6. 支持删除本地模型、TTS 缓存和阅读回声。
7. 不保存生成音频，除非未来用户明确请求缓存。

## 10. 性能指标

v4.0 验收目标：

- 首次模型下载不计入冷启动。
- 已下载模型后，开启希声到模型 ready：目标小于 5 秒，超过则显示“正在准备”。
- 单个短 chunk 生成：目标小于音频时长的 1 倍，理想小于 0.5 倍。
- 跳页取消：用户跳页后 300ms 内停止旧音频。
- 内存：默认只保持一个语言模型常驻；语言切换时可卸载旧模型。
- PDF 阅读不能因 TTS 阻塞滚动和渲染主线程。

## 11. 开发阶段

### Step 1：ReadableChunk 与双栏文本结构

- 从 TextSegment 生成 ReadableChunk。
- 实现行合并、段落合并、句子切分。
- 初步双栏检测。
- 测试中文、英文、双栏论文。

### Step 2：MeloLocalProvider 原型

- Python sidecar 最小可用。
- 中文模型跑通。
- 输入短句，输出 wav/pcm。
- 支持 cancel generation。

### Step 3：TTS Scheduler 与 ReadingClock 对接

- 根据 readingLineY 选择 chunk。
- 支持低声 / 随读模式。
- 支持暂停、跳页、换 PDF 取消。

### Step 4：希声 UI 与模型管理

- 控制栏小状态控件。
- 首次下载模型提示。
- 模型状态、错误提示、删除模型。

### Step 5：多语言与混排

- 中文、英文、日文模型按需加载。
- `languageHint` 到 provider language 映射。
- 中文中英混读优先走中文模型。
- 英文整段走英文模型。
- 日文整段走日文模型。

### Step 6：声音层级打磨

- TTS 与切档音效 ducking。
- 停止 / 跳页淡出。
- 稀疏朗读规则。

### Step 7：发布工程

- README v4.0 更新。
- 模型下载与许可证说明。
- Release notes。
- 测试与构建。

## 12. 验收清单

### 功能验收

- [ ] 希声默认关闭。
- [ ] 用户开启后可下载本地模型。
- [ ] 中文 PDF 可朗读当前阅读线附近片段。
- [ ] 英文 PDF 可朗读当前阅读线附近片段。
- [ ] 日文文本可按需朗读。
- [ ] 暂停滚动时朗读停止或暂停。
- [ ] 跳页后旧朗读不再继续。
- [ ] 换 PDF 后旧朗读彻底取消。
- [ ] 高速档位朗读变稀疏。
- [ ] 没有文本层时给出温和提示。

### 质量验收

- [ ] 不出现明显音频重叠。
- [ ] 不读页眉页脚为主。
- [ ] 双栏论文基本不串栏。
- [ ] 表格、公式、参考文献不过度朗读。
- [ ] TTS 不阻塞 PDF 渲染和自动滚动。
- [ ] 网络断开不影响已下载模型使用。

### 隐私验收

- [ ] 默认不发送文本。
- [ ] API provider 未开启时不会发起 TTS 网络请求。
- [ ] API provider 开启前有明确提示。
- [ ] 可删除本地 TTS 模型。

## 13. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| MeloTTS 打包 Python sidecar 复杂 | 发布体积和跨平台复杂度上升 | 模型按需下载；先做开发版 sidecar，再做打包方案 |
| PDF 文本顺序混乱 | 朗读体验差 | 先做 ReadableChunk 和双栏检测，再接 TTS |
| 生成延迟导致声音迟到 | 用户跳页后仍听旧文本 | generation id、取消队列、短 chunk |
| 多语言切换慢 | 混排体验断裂 | 中文模型处理中英混读；只在整段语言变化时切模型 |
| 模型质量不如预期 | 希声体验不成立 | 保留 Kokoro / API / 外部 provider 扩展点 |
| 分发体积过大 | 下载门槛升高 | 不把模型塞进初始 app；首次使用按需下载 |

## 14. 暂定技术决策

1. v4.0 默认本地模型路线选 MeloTTS。
2. 不把 TTS 模型打进初始安装包。
3. 不做系统语音作为默认，因为语音表现不满足需求。
4. API TTS 只作为 provider 扩展点，不作为默认体验。
5. 不追求逐词同步，只追求阅读线附近的弱同步。
6. 先解决 PDF 文本结构，再解决声音生成。
7. “希声”的声音密度必须受速度档位调节。

## 15. 后续可探索

- Kokoro ONNX provider：降低 Python sidecar 依赖。
- Qwen3-TTS 外部本地服务 provider：用户自行部署大模型。
- API provider：OpenAI / Azure / ElevenLabs / 火山等。
- OCR 后文本朗读：扫描 PDF 先 OCR，再进入 ReadableChunk。
- TTS 阅读回声：记录“上次低声读了多久”，但不要变成生产力统计。
