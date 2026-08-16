# 「希声」竞品工程调研：Spiel 与本地 TTS 阅读器路线

更新时间：2026-07-25
调研对象：Spiel、OpenReader、projectwhy-tts、Porua、Read It Out、Riddi
关联文档：`PRD_v4.0_HISHENG_TTS.md`、`ENGINEERING_LOG_v4.0_HISHENG_PHASE1.md`

> 本文严格区分三类证据：**源码确认**、**项目文档声称**、**本机实测**。README 中出现的能力如果尚未从源码或本机行为确认，不视为已经验证。

---

## 1. 调研目的

当前 `pdf-flow-reader` v4.0「希声」已经跑通本地 TTS 链路，但真实测试暴露出四个根本问题：

1. 中文书、英文书部分页面 `chunkCount = 0`，导致朗读半页后静默。
2. 英文双栏论文会将正文、脚注、URL、页脚拼进同一 chunk。
3. Kokoro 合成时出现鼠标转圈和自动滚动卡顿。
4. 当前 `kokoro-js` voice set 实测只有英语 voice，中文/日文目标未达成。

Spiel 宣称同时具备：

```text
Kokoro 本地服务
逐词高亮
自动滚动
PDF 阅读
句段预取
```

因此本次调研不只是评价 Spiel，而是回答：

- Spiel 的这些能力真实由什么机制实现？
- 哪些机制可直接迁移到「希声」？
- 哪些能力只适用于网页文章或“声音主导”的传统朗读器？
- 是否存在更适合 PDF、OCR、版面结构的开源参照物？

---

## 2. Spiel 安装故障：结论与修复

### 2.1 故障现象

用户运行：

```bash
curl -fsSL https://raw.githubusercontent.com/preet01/spiel/main/install.sh | bash
```

安装成功完成：

- Apple Silicon / macOS 检查。
- `uv` 安装。
- Kokoro-FastAPI 源码下载。
- Python 3.10 虚拟环境。
- 137 个 Python 依赖安装。
- voice pack 下载。

失败发生在最后的模型权重下载：

```text
Installation failed: Could not download the voice model
```

### 2.2 日志确认的根因

`~/.spiel/install.log` 显示：

```text
urllib.error.URLError:
<urlopen error [SSL: UNEXPECTED_EOF_WHILE_READING]
EOF occurred in violation of protocol>
```

失败 URL 来自：

```text
https://github.com/remsky/Kokoro-FastAPI/releases/download/v0.1.4/kokoro-v1_0.pth
```

结论：

- 不是磁盘不足。
- 不是 Python 版本或 arm64 wheel 失败。
- 不是目录权限问题。
- 是直连 GitHub Release 时 TLS 被中途断开。
- 同一机器直连 `git clone` 也复现 `SSL_ERROR_SYSCALL`，代理访问正常，进一步支持这一判断。

### 2.3 已执行的修复

使用本机代理：

```text
http://127.0.0.1:7897
```

并以断点续传方式下载：

```bash
curl -x http://127.0.0.1:7897 \
  -fL \
  --retry 8 \
  --retry-all-errors \
  --retry-delay 2 \
  --continue-at - \
  --output kokoro-v1_0.pth.part \
  https://github.com/remsky/Kokoro-FastAPI/releases/download/v0.1.4/kokoro-v1_0.pth
```

完成后原子改名为：

```text
~/.spiel/engine/api/src/models/v1_0/kokoro-v1_0.pth
```

本机实测文件大小：

```text
327,212,226 bytes
```

与 GitHub Release asset 元数据一致。

本机 SHA-256：

```text
496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4
```

GitHub 该旧 release 未提供官方 digest，因此这里只记录本机值，不能将其当作上游官方校验值。

### 2.4 安装器暴露出的工程缺陷

Spiel 安装器的模型下载逻辑使用 Python：

```python
urlretrieve(model_url, model_path)
```

存在几个问题：

1. 没有 retry。
2. 没有断点续传。
3. 没有代理提示或显式代理配置。
4. 下载直接写正式文件名，没有 `.part` 临时文件。
5. `verify_files()` 只检查文件非零，没有检查预期字节数或 checksum。
6. 安装失败后提示查看日志，但没有给出可复制的单步重试命令。

这意味着一次 300 MB 下载在网络不稳定地区很容易失败，并且理论上可能把截断的非零文件误判为有效。

对「希声」模型下载器的直接启示：

```text
必须使用临时文件 + resume + retry + expected size/hash + 原子改名。
```

---

## 3. Spiel 架构拆解

### 3.1 总体架构

Spiel 采用“浏览器扩展 + 本地 Python sidecar”结构：

```text
Chrome Extension
  ├── background service worker：播放状态、TTS 请求、缓存与预取
  ├── content script：文章提取、高亮、自动滚动、浮动 UI
  ├── offscreen document：Web Audio 播放
  └── pdf-content：按需加载 pdf.js，提取 PDF 全文
             │
             ▼
Kokoro-FastAPI
  http://127.0.0.1:8880
  PyTorch + MPS + Kokoro v1.0
```

本地服务通过 LaunchAgent 自动启动：

```text
~/Library/LaunchAgents/com.spiel.voice-engine.plist
```

全部引擎文件位于：

```text
~/.spiel
```

### 3.2 本地模型与 voice

Spiel 固定使用 Kokoro-FastAPI 的 PyTorch 模型：

```text
kokoro-v1_0.pth：約 312 MiB
Python 环境与依赖：约 2 GB 级
```

本机 voice 目录确认包含英语、中文、日文等 voice：

```text
中文：zf_xiaobei / zf_xiaoni / zf_xiaoxiao / zf_xiaoyi
日文：jf_alpha / jf_gongitsune / jf_nezumi / jf_tebukuro / jm_kumo
英语：af_* / am_* / bf_* / bm_*
```

但是 Spiel UI 当前只展示四个英语 voice：

```text
af_heart
af_bella
am_michael
bf_emma
```

因此“服务端存在 CJK voice”和“Spiel 产品已支持中文/日文”是两件事。后者需要真实 API 与扩展流程验证。

### 3.3 逐词时间戳

#### 源码确认

Spiel 请求：

```text
POST http://127.0.0.1:8880/dev/captioned_speech
```

请求体包含：

```json
{
  "model": "kokoro",
  "input": "...",
  "voice": "af_heart",
  "speed": 1,
  "response_format": "mp3",
  "stream": false,
  "return_timestamps": true
}
```

服务端返回：

```json
{
  "audio": "<base64>",
  "timestamps": [
    { "word": "...", "start_time": 0.1, "end_time": 0.4 }
  ]
}
```

这些 timestamp 来自 Kokoro 生成结果中的 token，而不是客户端按字符数平均猜测。音频裁剪后，Kokoro-FastAPI 还会相应修正 timestamp offset。

### 3.4 高亮时钟

Spiel 最值得借鉴的机制是：**音频播放是同步的唯一真时钟。**

流程：

```text
1. background 取得音频和词级 timestamp
2. offscreen document decodeAudioData
3. AudioBufferSourceNode 真正 start(0)
4. offscreen 发送 AUDIO_STARTED
5. background 转发 WORD_CLOCK_START
6. content script 才启动 requestAnimationFrame 高亮时钟
```

这避免了“合成完成”或“准备播放”被误当作“实际已经发声”。

跳句或停止时：

```text
OFFSCREEN_STOP 与 HIGHLIGHT_STOP 同时发送
```

下一段只有收到真实 `AUDIO_STARTED` 才重新启动高亮。

这条规则可直接迁移到「希声」：

> 任何视觉同步都只能由真实播放事件启动；停止音频的同一事件必须同时停止视觉时钟。

### 3.5 时间戳与页面 token 数不一致时的处理

Kokoro 可能展开数字与缩写：

```text
$3.5 → three point five dollars
```

导致 timestamp token 数和页面原词数不同。

Spiel 的做法：

1. 页面 DOM 与待朗读句都先规范化成 word tokens。
2. timestamp token 过滤为字母数字 token。
3. 数量不等时，按比例映射 timestamp index 到页面 word index。
4. timestamp 提前结束但音频仍在播放时，按真实音频 duration 插值推进剩余页面词。

这是一个实用的降级策略，但并非严格对齐。它适合“读到附近即可”的视觉辅助，不适合语言学级同步。

### 3.6 网页自动滚动

网页句子匹配成功后，Spiel 得到对应 DOM `Range`。当该句超出上下 120 px 安全区时：

```js
scrollIntoView({ behavior: 'smooth', block: 'center' })
```

因此其自动滚动模型是：

```text
声音选择下一句
→ 高亮下一句
→ 视觉页面跟着声音滚动
```

这与「希声」当前模型方向相反：

```text
ReadingClock / 自动滚动决定阅读线位置
→ 当前阅读线选择声音
```

两者不应简单合并。若将 Spiel 自动滚动照搬，会产生两个滚动权威：ReadingClock 与 TTS 同时争夺滚动位置。

独立架构审阅建议把音频同步锚定到 `AUDIO_STARTED`，这一点成立；但不应据此替换核心 ReadingClock。更合适的双时钟结构是：

```text
ReadingClock
  ├── 唯一滚动权威
  ├── 决定当前页、阅读线和候选 ReadableChunk
  └── 不由音频反向改写位置

TtsPlaybackClock
  ├── 只在 AudioBufferSourceNode 真正 start 后启动
  ├── 驱动当前 chunk 内的词/短语高亮
  └── pause / stop / skip 时与音频同步停止
```

再将策略拆开：

```text
HighlightPolicy：是否显示 chunk / sentence / word 反馈
ScrollPolicy：始终服从 ReadingClock，不由 TTS 调用 scrollIntoView
```

### 3.7 PDF 能力的真实边界

#### README/商店声称

```text
Reads PDFs
Word-by-word highlighting with auto-scroll
```

#### 源码确认

Spiel 的 PDF 路径：

1. content script 检测 PDF。
2. 按需注入 `pdf-content.js`。
3. `fetch(location.href)` 读取整份 PDF bytes。
4. `pdf.js getTextContent()` 逐页提取所有 fragments。
5. 根据 `hasEOL` 拼出换行，清理空格和断词。
6. 将整份 PDF 文本切成 sentences。

缺少：

- OCR。
- 双栏检测。
- bbox/geometry 到句子的映射。
- 页眉页脚重复检测。
- 表格/公式/脚注 role。
- 当前页局部加载。
- PDF 页内高亮 overlay。

Spiel 源码明确说明：PDF 无可高亮页面 DOM 时，**浮动播放器 caption** 承担逐词高亮。

因此当前真实能力是：

| 能力 | 网页文章 | PDF |
| --- | --- | --- |
| 句子高亮到原页面 | 有 | 无 |
| 逐词高亮到原页面 | 有 | 无 |
| 自动滚动原页面 | 有 | 无源码证据 |
| 浮层字幕逐词高亮 | 有/按需 | 有 |
| PDF 文本提取 | 不适用 | 有，但结构粗糙 |

仓库 Roadmap 也把：

```text
In-PDF page highlighting (Spiel Reader view)
```

列为未来能力。

结论：Spiel 不能作为「PDF 页内逐词高亮已成熟」的证据，但可作为“网页 DOM 高亮与播放时钟同步”的代码样板。

#### 本地 `file://` PDF 的已验证 CORS 缺陷

对本机文件 `Reputation and Civil War` 做了隔离 Chrome + Spiel 源码版复现：

```text
isAllowedFileSchemeAccess = true
PDF.js 在 Node 中完整解析 271 页、515,583 字符
Spiel content script 仍在 fetch(location.href) 处失败
```

原始浏览器错误：

```text
Access to fetch at 'file:///...pdf' from origin 'null'
has been blocked by CORS policy
TypeError: Failed to fetch
```

根因位于 `src/pdf-content.ts`：

```js
const res = await fetch(location.href);
```

Chrome 内置 PDF Viewer 中注入的 content script 对本地 `file://` 文档处于 `origin: null`，因此直接 fetch 被 CORS 拦截。即使用户已经打开“允许访问文件网址”，该行仍会失败。Spiel 随后把 `TypeError: Failed to fetch` 折叠为 `pdf-parse`，并误导性地显示：

```text
Could not read this PDF. It may be password-protected or corrupted.
```

同一隔离环境中，extension service worker 对同一个 file URL 能成功读取全部 `3,474,897` bytes。因此正确修复方向是：

```text
background/service worker 读取 file URL
→ 在 extension-owned offscreen/reader context 中解析
→ 不在 origin-null content script 直接 fetch(file://)
```

临时绕行方式是把 PDF 目录通过仅绑定 `127.0.0.1` 的本地 HTTP server 提供，再用 `http://127.0.0.1:<port>/...pdf` 打开。该问题预计影响 Spiel 1.1.2 的本地 PDF，而非本书独有。

### 3.8 缓存与预取

Spiel 使用：

```text
LRU cache，最多 20 clips
key = sentenceIndex | voice | speed
```

当前句送入 offscreen 播放以后，才预取：

```text
index + 1
index + 2
```

原因：若预取先启动，用户正在等待的当前句会被堵在单 worker 队列后面。

它还在 queued job 真正执行时再次检查 cache，避免：

```text
提交任务时 cache miss
→ 等待队列期间 prefetch 已完成
→ 当前任务仍重复合成同一句
```

这一条对「希声」当前 prefetch 直接适用：

> cache、generation、current index 必须在任务执行时重检，不能只在入队时检查。

### 3.9 取消策略

Spiel 明确不 abort 正在执行的 Kokoro-FastAPI 请求：

```text
NEVER abort an in-flight TTS request
```

原因是上游存在中途取消导致服务崩溃的已知问题，并且服务本身串行化请求。

其取消是逻辑取消：

```text
generation++
旧任务完成后检查 generation
过期结果丢弃
未发出的 queued job 在执行前跳过
```

这和「希声」当前 generation 思路一致，但提醒我们：

- provider 的 `cancel()` 不能假定底层推理真正可安全中断。
- child process 隔离之后，可以在必要时通过杀进程实现 hard reset，但应视作故障恢复，不是日常跳句机制。

### 3.10 速度与 voice 改变

Spiel 曾经在速度改变后立即重新合成当前句，造成 3–4 秒静默。现在改为：

```text
当前句继续播放
新速度从下一句生效
后台预取下一句和下下句的新速度版本
```

这条产品规则值得迁移：

> 不要为可延迟到自然边界的设置变化中断一段正在正常播放的音频。

### 3.11 首段延迟优化

Spiel 的句子切分会特意把首段第一句切成一个更短的 opening clause：

```text
约 25–55 chars
```

这样用户更快听到首个音频；后续句段保持正常长度。

对「希声」而言，可转化为：

```text
第一次开启希声时，优先选择阅读线附近的一个短、完整、可理解句子；
不要用超长段落做第一条合成。
```

### 3.12 本机资源与启动体验

本机首次启动期间观察到：

```text
Python/Kokoro-FastAPI 进程物理 footprint：约 2.3 GB
Uvicorn 在模型 warmup 完成前不监听 8880
启动日志在较长时间内几乎为空
```

`pydub` 会警告找不到系统 `ffmpeg`，但源码确认 MP3 编码实际使用 PyAV 自带 `libmp3lame`，因此不需要额外安装 ffmpeg。

这一资源代价远大于当前「希声」的：

```text
Kokoro q8 ONNX / kokoro-js：約 86 MB 模型
```

是否值得采用 FastAPI/PyTorch 路线，必须由中文质量、时间戳价值和实际 RTF 共同决定。

### 3.13 本机中英日基准

服务启动后，使用 `/dev/captioned_speech`、MP3、`return_timestamps: true` 顺序测试三种语言：

| 语言 | voice | 请求耗时 | 音频时长 | RTF | timestamp 数 | 结果 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 英文 | `af_heart` | 1.437 s | 6.696 s | 0.21 | 12 | 成功 |
| 中文 | `zf_xiaobei` | 2.870 s | 8.136 s | 0.35 | 0 | 音频成功，但无词级时间戳 |
| 日文 | `jf_alpha` | 3.439 s | 无 | 无 | 无 | HTTP 500 |

英文在 warm 状态下合成速度明显快于播放时长，适合后台预取。英文 timestamp 与句中词数基本对应，Spiel 的网页逐词高亮闭环在该语言上成立。

中文也能以小于 1 的 RTF 生成自然长度音频，但该请求返回零个 timestamp。因此：

```text
Kokoro-FastAPI 中文可合成 ≠ Spiel 中文可逐词高亮
```

日文失败堆栈：

```text
Failed initializing MeCab
unidic/dicdir/mecabrc: no such file or directory
```

安装器安装了 `unidic` Python 包，却没有下载实际 UniDic 字典。补全该字典可能再增加数百 MB，而且 Spiel UI 当前也未暴露日文 voice，所以本次不继续扩大安装。

这组测试要求我们以后按能力维度描述 provider，而不能只给一个笼统的 `languages` 数组：

```text
synthesisLanguages
wordTimestampLanguages
installedRuntimeDependencies
validatedVoices
```

---

## 4. 开源同类项目矩阵

### 4.1 路线分类

本地 TTS 阅读器大致分成五条工程路线：

```text
A. Python/PyTorch sidecar
B. Rust/ONNX sidecar
C. 浏览器内 ONNX/WebGPU/WASM
D. 重型自托管文档平台
E. 桌面集成式 PDF/OCR/TTS
```

### 4.2 比较表

| 项目 | 路线 | 本地 TTS | PDF 结构 | 高亮 | 自动滚动 | 主要价值 | 主要局限 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Spiel** | Python/PyTorch sidecar + Chrome | Kokoro-FastAPI | pdf.js 全文顺序拼接，无 OCR/双栏 | 网页原位词级；PDF 仅浮层 caption | 网页有 | 播放时钟、generation、LRU、预取、错误经验库 | 资源重；PDF 结构弱；PDF 页内高亮尚未完成；UI 英语优先 |
| **Porua** | Rust/ONNX sidecar + 扩展 | Kokoro ONNX | 以网页段落为主，未见成熟 PDF 版面链路 | phrase-level | 项目文档未充分确认 | engine pooling、并发、streaming multipart | 28 个英语 voice；短语时间戳约 70–75% 字符权重估算，不是真词级对齐 |
| **Read It Out** | 浏览器内 ONNX/WebGPU/WASM | bundled Kokoro ONNX | 以网页为主 | current-item highlighting | 会将当前 item 滚入视图 | 无 sidecar；provider adapter 清晰；WebGPU/WASM 可选 | Chrome Kokoro 才完整；模型随扩展变大；README 未证明 PDF 几何高亮与真词级 timestamp |
| **Riddi** | 浏览器内 ONNX Runtime Web | Supertonic 3 | 网页 Readability | 项目声称 paragraph + word | 项目声称 smooth auto-scroll | 31 语言、WebGPU/WASM、无需本地服务 | Supertonic 3 官方语言列表不含中文；PDF 不是核心场景；模型打包重 |
| **OpenReader** | 重型自托管 Next.js + compute worker | Kokoro/Kitten/Orpheus/API | PP-DocLayoutV3 ONNX、跨页拼接、几何高亮；仍依赖 text layer，不是 OCR | Whisper ONNX 词级对齐 | read-along | PDF 结构与精确对齐最完整的参照 | 扫描件仍需 OCR；NATS JetStream、对象存储、数据库、worker control plane 对单机 Electron 过重 |
| **projectwhy-tts** | PyQt6 桌面集成 | in-process Kokoro | PP-DocLayout region detection、多栏、block type | word + block | 当前区域保持可见 | 与「希声」场景最接近；布局块可 Speak/Skip | 项目自述非 production-grade；Python/Paddle/Kokoro 依赖仍重 |
| **Read Aloud** | 浏览器/system TTS | Web Speech / 多 provider | 网页为主 | 成熟的句级/页面跟随 | 有 | 1.7k stars，浏览器扩展生命周期参考 | 非 Kokoro 本地 PDF 专用；对 PDF/OCR 帮助有限 |

### 4.3 成熟度线索

截至调研时间，GitHub 元数据：

```text
Spiel：2 stars，0 forks，Chrome 商店 4 users
Porua：19 stars，3 forks
OpenReader：约 467 stars，68 forks，51 releases
Read Aloud：约 1.7k stars，294 forks
Read It Out：2 stars
```

星数不代表代码质量，但可作为真实用户覆盖与长期故障暴露程度的线索。Spiel 是很新的工程样本，不应被当作成熟行业标准。

---

## 5. 对「希声」可立即迁移的设计

### 5.1 真正的 `AUDIO_STARTED` 事件

当前「希声」已经有 Web Audio player，但后续如果做 chunk 内高亮或阅读线 phase，应确保：

```text
provider synthesis completed ≠ audio started
AudioBuffer decoded ≠ audio started
AudioBufferSourceNode.start() 后的确认事件 = 视觉同步起点
```

建议加入：

```text
onAudioStarted({ chunkKey, generation, duration })
onAudioPaused(...)
onAudioStopped(...)
onAudioEnded(...)
```

### 5.2 同一事件停止声音与视觉时钟

跳页、停止、改文档、切模式时：

```text
stop audio
stop highlight/focus clock
release playback lock
```

必须由同一个状态转换发出，避免视觉线继续跑而声音已经停。

### 5.3 执行时重检，而不只入队时检查

scheduler queued job 真正执行前应重检：

```text
documentGeneration
pageNumber
chunkKey
provider/voice/speed
prefetch cache
current reading line relevance
```

### 5.4 缓存有界

将当前单个 next prefetch 扩展为有界 LRU 时，应按：

```text
documentId | chunkKey | provider | voice | speed | textHash
```

做 key；限制 clip 数量或字节量，并在换 PDF 时 hard reset。

### 5.5 设置从下一自然边界生效

速度/voice 改变时：

```text
不中断正在正常播放的当前 clip
清理不兼容的未来缓存
下一 chunk 使用新设置
```

### 5.6 无无限静默

Spiel 的 90 秒 watchdog 过于宽松，但“任何 silent wait 必须有上限”是正确的。

「希声」更适合：

```text
预计合成赶不上阅读线 → 跳过
provider 真卡住 → error + 静默降级
绝不让 PDF 滚动等待 TTS
```

### 5.7 经验日志机制

Spiel 的 `LESSONS.md` 将每次用户可见错误记录为：

```text
Symptom → Root cause → Mistake class → Fix → Rule
```

建议「希声」也建立 `docs/HISHENG_LESSONS.md`，特别记录：

- renderer 无法 import bare `kokoro-js`。
- CJK voice 名称与实际 voice set 不一致。
- OCR cache 存在但 current page chunks 为空。
- prefetch 入队与执行之间状态变化。
- TTS 导致 Electron 卡顿。

### 5.8 Provider capability 与 voice 实测注册

OpenReader 的多 provider 思路和本次中英日实测共同说明，不能再用一个宽泛的 `languages` 字段表示能力。建议 provider 暴露：

```js
{
  synthesisLanguages,
  wordTimestampLanguages,
  validatedVoices,
  runtimeDependencies,
  supportsSafeAbort,
  supportsStreaming,
}
```

首次显示 voice 前可运行极短探测：

```text
英文：Hello.
中文：你好。
日文：こんにちは。
```

探测失败则不显示或标注不可用，而不是依赖静态 voice 名称推断支持程度。

### 5.9 PDF 空结果必须有分层状态

综合 Spiel 的 `pdf-empty/pdf-parse` 与 OpenReader 的 `no-text-layer`，建议诊断状态至少区分：

```js
"ok"
"no-text-layer"
"ocr-required"
"ocr-empty"
"layout-empty"
"chunker-empty"
"parse-error"
```

每页同时记录：

```js
{
  nativeTextItems,
  nativeChars,
  ocrChars,
  layoutBlocks,
  readableChunks,
  filteredChars,
}
```

这样 `chunkCount = 0` 才能定位到文本层、OCR、layout 或 chunker 中的具体一层。

### 5.10 缓存键与非阻塞写入

综合 Spiel、Porua 与 OpenReader，正式缓存键应至少包含：

```text
documentFingerprint
chunkKey
textHash / normalizedTextHash
providerId / modelId / engineVersion
voiceId / language / speed
```

Porua 的两个规则值得直接采用：

1. cache 写入使用 fire-and-forget，不阻塞首播。
2. cache 失败不能让朗读主链路失败。

若未来在 PDF text layer 上绘制高亮，可借 Porua 的 `DOMTextMapper + Range + MutationObserver`；若继续使用独立 overlay，只迁移“文本 offset 映射到 geometry”的思想，避免改写 PDF.js DOM。

### 5.11 PDF layout 的近期轻量路线

OpenReader 的 PP-DocLayoutV3 值得做中期 PoC，但它不是 OCR，且完整 compute worker 过重。近期先统一 `ReadableBlock` 数据模型：

```text
text / bbox / page / column / role / readingOrder / source
```

处理顺序：

```text
pdf.js text items 保留坐标
→ 按 x 分布做 column clustering
→ 按重复 y-band 过滤页眉页脚
→ column 内从上到下、左栏到右栏
→ 无 text layer 时进入现有 OCR
→ OCR 结果也转成同一 ReadableBlock
```

只有轻量坐标规则仍不能稳定处理的页面，再启用 PP-DocLayout small ONNX。

---

## 6. 不应直接照搬的部分

### 6.1 不照搬“声音驱动滚动”

Spiel 是传统 read-aloud：声音是主时钟，页面跟着声音走。

「希声」的产品核心是：视觉阅读为主，ReadingClock 决定声音何时出现。

因此：

```text
保留 ReadingClock 为唯一滚动权威；
TTS 不得调用 scrollIntoView 改变主阅读位置；
词级 timestamp 只可用于当前 chunk 内的轻微视觉反馈。
```

### 6.2 不照搬整份 PDF 全文提取

Spiel 一次读取整份 PDF 并按页拼接，违背「希声」当前的局部、可取消、低资源方向，也无法解决双栏和 OCR。

### 6.3 不照搬“删除所有括号内容”

Spiel 会固定跳过：

```text
URLs
[reference brackets]
(parentheticals)
```

对网页通俗文章可以接受，对学术论文不够稳妥。括号可能包含定义、限定条件、变量含义。我们应继续使用 layout role、语义类型和档位策略，而不是无差别删除括号。

### 6.4 不立即采用 OpenReader 全栈

OpenReader 的：

```text
NATS JetStream
SeaweedFS / S3
SQLite/Postgres
auth/session
external compute worker
Whisper alignment
```

适合自托管平台，不适合当前单机 Electron 产品。可借鉴算法思想，不照搬部署拓扑。

### 6.5 不将逐词高亮提前为 v4.0 主线

PRD 明确把逐词强同步列为非目标。当前最大问题仍是：

```text
有无可靠 chunk
是否读对内容
是否不卡顿
中文是否自然
```

在这些问题解决前，逐词高亮只会让错误文本和不同步更显眼。

---

## 7. 推荐的下一步实验顺序

### Experiment 1：Spiel 服务基准（首轮已完成）

首轮中英日 warm 请求结果见 §3.13。后续仍需补充精确 cold start 与多次方差。统一记录：

```text
cold start time
ready memory
first request latency
warm request latency
audio duration
RTF = synthesis time / audio duration
word timestamp coverage
```

文本样本：

```text
英文书短句
英文论文句
中文书短句
中文论文句
日文短句
中英混排句
```

voice：

```text
af_heart
zf_xiaobei
jf_alpha
```

### Experiment 2：验证中文/日文 voice 是“存在”还是“可用”（初步完成）

当前结论：中文能生成音频但无 timestamp；日文默认安装缺少 UniDic 字典而失败。仍需用户耳听中文自然度，并在决定是否追加日文字典后再评估：

- 发音是否正确。
- 英文夹杂是否可读。
- punctuation pause 是否自然。
- timestamp 是否完整。
- CJK timestamp token 如何分词。

### Experiment 3：仅做外部 provider PoC，不立即替换默认 provider

可新增实验 provider：

```text
KokoroFastApiProvider
endpoint: http://127.0.0.1:8880/dev/captioned_speech
```

先只用于 benchmark，不进入正式 UI。

### Experiment 4：先隔离 TTS，再讨论默认模型

若 FastAPI 质量明显优于 kokoro-js，应采用：

```text
Electron main
→ managed child process
→ localhost/stdio provider
→ renderer Web Audio
```

不要把 PyTorch 推理放回当前 local server 主事件循环。child process 需有：

```text
启动状态
ready 状态
memory/CPU 诊断
超时
故障重启
退出清理
```

### Experiment 5：借 projectwhy/OpenReader 修 PDF 结构

近期轻量版：

```text
page region splitter
left/right column
header/footer/footnote region
fallback line chunks
```

中期 PoC：

```text
PP-DocLayout small ONNX
```

先验证它能否显著降低：

```text
chunkCount=0
双栏串栏
正文与脚注混合
```

### Experiment 6：最后才做 chunk 内弱高亮

若仍符合产品方向，可以只做：

```text
当前 ReadableChunk 内的词级或句级轻高亮
不让 TTS 驱动滚动
不做整页 karaoke
```

---

## 8. 当前判断

### 对 Spiel 的判断

Spiel 是一个值得读源码的轻型工程样本，最强的部分是：

```text
真实音频事件驱动高亮
single-flight 队列
generation 逻辑取消
有界缓存
下一/下下句预取
大量真实 bug lessons
```

它没有解决「希声」当前最困难的 PDF 问题：

```text
OCR
多栏阅读顺序
页眉页脚与脚注
几何映射
PDF 页内高亮
```

而且其 PyTorch sidecar 的资源与冷启动代价明显。

### 对「希声」路线的判断

最合理的组合不是“把 Spiel 搬进来”，而是：

```text
Spiel 的播放状态与同步纪律
+
projectwhy/OpenReader 的 PDF 版面块思想
+
「希声」自己的 ReadingClock 视觉主导原则
```

近期主线仍应保持：

```text
先让当前页稳定产生正确 ReadableChunk
→ 再隔离 TTS 推理消除卡顿
→ 再验证中文/日文 provider
→ 最后考虑 chunk 内弱高亮
```

---

## 9. 本地调研产物

Spiel 源码已下载到：

```text
resources/competitors/spiel
```

源码构建已通过：

```text
typecheck
esbuild
runtime asset completeness verification
```

扩展包：

```text
resources/competitors/spiel/spiel-extension.zip
```

可在 Chrome：

```text
chrome://extensions
→ Developer mode
→ Load unpacked
→ 选择 resources/competitors/spiel/dist
```

或者解压 `spiel-extension.zip` 后选择解压目录。

本地引擎：

```text
~/.spiel
```

服务端口与当前状态：

```text
http://127.0.0.1:8880
GET /health → {"status":"healthy"}
LaunchAgent: com.spiel.voice-engine
```

引擎日志：

```text
~/Library/Logs/spiel-voice-engine.log
```

安装日志：

```text
~/.spiel/install.log
```

本机基准产物：

```text
resources/competitors/spiel-benchmark/english-af_heart.mp3
resources/competitors/spiel-benchmark/chinese-zf_xiaobei.mp3
resources/competitors/spiel-benchmark/english-af_heart.json
resources/competitors/spiel-benchmark/chinese-zf_xiaobei.json
```

---

## 10. 来源

- Spiel：<https://github.com/preet01/spiel>
- Spiel Chrome Web Store：<https://chromewebstore.google.com/detail/spiel/dkfdbjaghlaldbdleidhkinpekabffij>
- Kokoro-FastAPI：<https://github.com/remsky/Kokoro-FastAPI>
- OpenReader：<https://github.com/richardr1126/openreader>
- projectwhy-tts：<https://github.com/thepycoder/projectwhy-tts>
- Porua：<https://github.com/ShahadIshraq/porua>
- Read It Out：<https://github.com/Spartan-71/Read-It-Out>
- Riddi：<https://github.com/pmbstyle/Riddi>
- Read Aloud：<https://github.com/ken107/read-aloud>
