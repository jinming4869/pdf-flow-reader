<p align="center">
  <img src="docs/assets/readme/hero.svg" width="100%" alt="夜晚的书斋：本地、离线、有阅读节奏感的 PDF 连续阅读器" />
</p>

<p align="center">
  <a href="https://github.com/jinming4869/pdf-flow-reader/releases/tag/v4.0.0"><img alt="Release v4.0.0" src="https://img.shields.io/badge/release-v4.0.0-527562?style=flat-square" /></a>
  <img alt="macOS Apple Silicon" src="https://img.shields.io/badge/macOS-Apple%20Silicon-24362d?style=flat-square&logo=apple" />
  <img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-24362d?style=flat-square&logo=windows" />
  <img alt="Local first" src="https://img.shields.io/badge/privacy-local--first-527562?style=flat-square" />
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-c76543?style=flat-square" /></a>
</p>

<p align="center">
  <strong>让 PDF 阅读和轻吻纸质书一样好玩。</strong><br />
  <sub>Make reading PDFs as delightful as gently kissing a paper book.</sub><br />
  <sub>从「回音」到「希声」，再到正在设计的「航迹」。</sub>
</p>

<p align="center">
  <a href="https://github.com/jinming4869/pdf-flow-reader/releases/download/v4.0.0/night-study-4.0.0-mac-arm64.zip"><strong>下载 macOS 版</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/jinming4869/pdf-flow-reader/releases/download/v4.0.0/night-study-4.0.0-windows-portable.exe"><strong>下载 Windows 版</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/jinming4869/pdf-flow-reader/releases/tag/v4.0.0">查看 Release</a>
</p>

<p align="center"><sub>PDF、OCR 与中英日朗读默认在本机完成；模型随桌面包提供。</sub></p>

---

## 故事从“再滚一下”开始

读一篇几十页的论文时，手常常比眼睛更忙：向下滚一点，停住；读完两段，再滚一点。刚进入作者的思路，注意力又被触控板和页码拉回现实。

**「夜晚的书斋」从这个很小的疲惫开始。** 打开 PDF，纸页会按你选择的速度缓缓流动。你仍然自己读、自己停、自己决定哪里值得回看；应用只替你接住那些机械动作。

<p align="center">
  <img src="docs/assets/readme/reader-interface.png" width="92%" alt="暖色长日留痕阅读界面，包含 PDF 页面、阅读速度、希声和 OCR 控件" />
</p>

<p align="center"><sub>长日留痕 · 按 R 或乐符，朗读阅读线下方最近一句；图中为合成演示 PDF</sub></p>

---

## 一间书斋，三次学会陪伴

「夜晚的书斋」不是从功能清单里长出来的。每个大版本只回答一个问题：怎样让人在屏幕前多留一会儿，耐心读完一本本来可能被搁置的电子书？

### v3「回音」：书页第一次回应人的节奏

一条普通的速度滑杆，被分成六种阅读天气。雪国朦胧、美学散步、长日留痕、流觞曲水、强风吹拂、万物繁盛——数字仍然准确，名字则替身体感受赋形。背景、粒子、声音和阅读回声让“滚动速度”不再只是设置，而成为书与读者之间的节奏。

### v4「希声」：声音退到阅读身旁

朗读不再从第一页接管整本书。它会看见阅读线、页面位置与当前速度：慢时陪伴，快时略去枝节，需要抉择时等待一次按键或点击。声音不是另一个播放器，而是书页流动时偶尔浮起的水纹。

### v5「航迹」：书记住人在哪里被触动

下一章正在设计。读者可以用一枚丝带环套索，在书页上留下墨线，圈住一个真正想带走的瞬间。页面暂停，高清片段先在本机落盘；读者为它点下一枚“效价 × 唤醒”的情绪坐标，再亲手回到书流。久而久之，一本 PDF 不只有页码和进度，也拥有一条可回看的情绪航迹。

> 「航迹」仍处于规划阶段，不包含在当前 v4.0.0 下载中。公开设计记录见 [`docs/v5-hangji/`](./docs/v5-hangji/README.md)。

---

## 让纸页流动，而不是把文档变成播放器

「夜晚的书斋」首先是一间安静的阅读室。

- **4–64 px/s 平滑自动滚动**，开始与暂停都有缓冲，不让纸页突然失速。
- **按文字密度估算阅读速度**，分别显示字/分、词/分和剩余阅读时间。
- **大型 PDF 按区间读取**，先出现纸页底稿，再逐步显影当前页附近的高清画布。
- **跳页就取消旧任务**，不让已经离开的渲染、OCR 或声音迟到。
- **减少动画友好**，尊重系统的 `prefers-reduced-motion` 设置。


---

## 一条滑杆，六种阅读天气

速度不只是一串数字。

慢下来时，页面像雪后的原野；再快一点，像沿着城市与思想散步；到了最快的两档，背景沉入风与夜色，声音也不再主动追赶你。六档速度分别决定视觉氛围、文字密度反馈，以及“希声”应该怎样出现。

<p align="center">
  <img src="docs/assets/readme/six-rhythms.svg" width="100%" alt="六档阅读节奏：雪国朦胧、美学散步、长日留痕、流觞曲水、强风吹拂、万物繁盛" />
</p>

| 阅读节奏 | 希声怎样出现 |
| --- | --- |
| **雪国朦胧** | 舒适随读，并预备后续可读片段；需要时提前准备下一页文字 |
| **美学散步** | 以 1.5–2.5× 跟随纸页，略去脚注、旁注和来不及的岔路 |
| **长日留痕** | 保持安静；按 `R` 或乐符，只读阅读线下方最近一句 |
| **流觞曲水** | 越过一个自然段时，让下一段的首句泛起声音 |
| **强风吹拂** | 开启点句后，点击 PDF 中的完整句子即可朗读 |
| **万物繁盛** | 页面高速流动，声音仍只响应你点到的那一句 |

---

## 希声：声音应当靠近阅读，而不占据阅读

传统 TTS 常常从第一页一路念到底。它很勤奋，却未必知道你正看到哪里。

“希声”沿着当前页面、阅读线和速度档位工作：慢时陪你走，稍快时替你略去枝节，中速时等待一个明确动作，最快时把决定权交还给鼠标。中英、日英混排会分别路由到适合的本地声音，再拼成连续音频。

当你跳页、暂停、换文档或停止朗读，旧 worker 会真正结束；已经离开的句子不会在新页面里迟到。

<p align="center">
  <img src="docs/assets/readme/reader-point-mode.png" width="92%" alt="深色万物繁盛界面，顶部显示点击以朗读，底部显示高速阅读节奏" />
</p>

<p align="center"><sub>万物繁盛 · 顶部开启点句模式后，点击 PDF 中的完整句子即可朗读</sub></p>

---

## 一份 PDF，从打开到发声，都留在本机

v4.0.0 的正式桌面路径默认使用随包提供的本地资源：

- PDF.js 先读取原生文字层。
- 原生文字不足时，Tesseract.js 只识别当前页附近的扫描页。
- 英文使用本地 Kokoro q8；中文、日文使用 Kokoro v1.0 int8 与自包含 CJK worker。
- 最近阅读、速度和界面偏好只写入本地存储。
- 本地服务只监听 `127.0.0.1`。

<p align="center">
  <img src="docs/assets/readme/local-first.svg" width="100%" alt="PDF 经原生文字或本地 OCR 进入可读文本，再由本地 Kokoro 模型生成声音" />
</p>

> PDF 文件、OCR 文字与内置朗读内容都在本机处理。模型已随桌面包提供，首次朗读不需要另行下载。

---

## 航迹：技术退到背景，人在书页上留下来

阅读中的重要时刻不总是一段“值得摘抄的知识”。有时是困惑，有时是愤怒，有时只是某一句话突然让人放松。传统笔记工具要求读者离开文本、选择颜色、填写标题、整理目录；「航迹」想做相反的事：只让中断持续到足够留下这一瞬，然后尽快把人送回书中。

规划中的一次套索会经过这条路径：

```text
丝带环套索圈选
→ 自动暂停纸页与声音
→ 高清截图首先本地保存
→ 点下一枚连续的情绪坐标
→ AI 在后台补上一句关键复述
→ 手动“回到书流”
→ 30 秒或 90 秒缓慢重新入流
```

情绪不是由模型猜测。横轴记录负面到正面的效价，纵轴记录低到高的唤醒；读者自己落点。书架则把这些点按页码与先后顺序连成一张图，点击任一坐标都能回到当时的截图、复述和原书位置。

### 两种 AI，两种出现方式

「航迹」接受在线大模型成为正式但可选的产品能力，同时把它限制在清楚的边界内：

| 场景 | 计算策略 | 产品约束 |
| --- | --- | --- |
| 套索后的“一句复述” | 本地小模型或在线快速模型 | 高频、短文本，目标 1–3 秒；截图与情绪先保存，失败或断网不阻塞回流，联网后可以补生成 |
| 书架中的“分析 / 全文总结 / LSE Worksheet” | 用户主动触发的在线强模型 | 低频、长上下文、质量优先；允许等待并选择模型，不进入流动阅读界面 |

第一版模型层会抽象为 provider，从一个 OpenAI-compatible API 开始；密钥单独授权，并存入 macOS Keychain 或 Windows Credential Manager。应用不会读取 Zotero 的配置文件或复制其中的凭据。

已经打磨过的 Zotero GPT Prompt 会成为书架中的产品资产，但 Zotero 本身只承担两个角色：Prompt 的来源之一，以及用户确认后的阅读成果归档目的地之一。Obsidian 与专用本地文件夹也可以成为去处；阅读痕迹始终先拥有本地、可恢复的事实记录。

---

## 下载与安装

| 平台 | 下载 | 说明 |
| --- | --- | --- |
| macOS Apple Silicon | [`night-study-4.0.0-mac-arm64.zip`](https://github.com/jinming4869/pdf-flow-reader/releases/download/v4.0.0/night-study-4.0.0-mac-arm64.zip) | 适用于 M 系列芯片，解压后打开「夜晚的书斋.app」 |
| Windows x64 | [`night-study-4.0.0-windows-portable.exe`](https://github.com/jinming4869/pdf-flow-reader/releases/download/v4.0.0/night-study-4.0.0-windows-portable.exe) | 便携版，无需安装 |
| 完整性校验 | [`SHA256SUMS.txt`](https://github.com/jinming4869/pdf-flow-reader/releases/download/v4.0.0/SHA256SUMS.txt) | 用于核对下载文件是否完整 |

下载后可用系统工具核对文件名对应的哈希：

```sh
# macOS
shasum -a 256 night-study-4.0.0-mac-arm64.zip

# Windows PowerShell
Get-FileHash night-study-4.0.0-windows-portable.exe -Algorithm SHA256
```

### 三步开始

1. 打开「夜晚的书斋」。
2. 选择一份 PDF，或把文件拖进阅读区域。
3. 调节速度，让纸页按你的节奏流动；需要时按 `H` 开启希声。

<p align="center">
  <img src="docs/assets/readme/welcome.png" width="92%" alt="夜晚的书斋欢迎页，显示选择 PDF 与本地阅读回声" />
</p>

<p align="center"><sub>欢迎页 · 选择或拖入 PDF，阅读记录与偏好只写入本地存储</sub></p>

### 未签名应用提示

当前版本尚未购买开发者证书：

- **macOS**：若提示无法验证开发者，请右键应用并选择“打开”。
- **Windows**：若 SmartScreen 提示风险，请先核对下载来源与 SHA-256，再选择“更多信息”。

当前正式资产支持 macOS Apple Silicon 与 Windows x64；Intel macOS 和 Linux 暂无安装包。

---

## 你可能会喜欢它，如果……

- 你常读论文、报告、书稿和几百页的扫描 PDF。
- 你想减少滚轮操作，但仍希望以视觉阅读为主。
- 你会在中文、英文和日文材料之间切换。
- 你在意文件留在本机，不愿把整份文档交给云端。
- 你喜欢工具有一点气质，却不想被动画和功能按钮包围。

---

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Space` | 暂停 / 继续自动滚动 |
| `H` | 开启 / 关闭希声 |
| `R` | 在“长日留痕”中朗读阅读线下方最近一句 |
| `Esc` | 立即停止当前朗读 |
| `D` | 打开本地语音诊断面板 |

---

<details>
<summary><strong>从源码运行</strong></summary>

基础浏览器版需要 Node.js 18 或更高版本。完整离线 TTS 体验以桌面发布包，或已经完成 runtime 构建的开发环境为准。

### macOS

```sh
./start-reader.sh
```

也可以带文件路径启动：

```sh
./start-reader.sh "/path/to/document.pdf"
```

### Windows

双击：

```text
start-reader.cmd
```

或在 PowerShell 中运行 `start-reader.ps1`。

</details>

<details>
<summary><strong>开发与构建桌面版</strong></summary>

推荐使用 Node.js 24、Python 3.12 与 [uv](https://docs.astral.sh/uv/)。

```sh
npm ci
uv sync --project runtime/tts-multilingual --frozen
uv run --project runtime/tts-multilingual --frozen python scripts/build-multilingual-runtime.py
uv run --project runtime/tts-multilingual --frozen python scripts/prepare-english-model.py
npm test
npm run app:start
```

生成发布包：

```sh
npm run app:dist
```

模型由脚本从固定地址下载，并在打包前校验字节数与 SHA-256；大文件不进入 Git。

</details>

---

## 技术与许可

- 界面：原生 HTML、CSS、JavaScript
- PDF 渲染：[Mozilla PDF.js](https://github.com/mozilla/pdf.js)
- 本地 OCR：[Tesseract.js](https://github.com/naptha/tesseract.js)
- 本地语音：[Kokoro](https://github.com/hexgrad/kokoro)、ONNX Runtime、Misaki、pyopenjtalk
- 桌面运行时：[Electron](https://www.electronjs.org/)
- 自动化测试：289 项 Node 回归测试与 5 项 CJK worker 单测

项目代码采用 [MIT License](./LICENSE)。第三方组件、模型与字典许可见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。版本变化见 [`CHANGELOG.md`](./CHANGELOG.md)。

<p align="center">
  <img src="build/icon-day.png" width="74" alt="夜晚的书斋日间图标" />
  &nbsp;&nbsp;
  <img src="build/icon-night.png" width="74" alt="夜晚的书斋夜间图标" />
</p>

<p align="center"><sub>06:00–18:00 使用日间图标，18:00–06:00 使用夜间图标。</sub></p>
