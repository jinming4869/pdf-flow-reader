# 夜晚的书斋 pdf-flow-reader 项目

> 让 PDF 阅读和亲吻纸质书一样好玩。

一个本地、轻量、有阅读节奏感的 PDF 连续阅读器。打开后，页面会以可调的速度自动向下移动，让论文、报告和长文档读起来少一点手动操作。PDF 只在本机处理，不会上传。

## 下载

普通用户建议直接下载 GitHub Releases 里的桌面版压缩包或便携版程序，而不是下载源码。

- macOS Apple Silicon：下载 `night-study-4.0.0-mac-arm64.zip`，解压后双击 `夜晚的书斋.app`。
- Windows x64：下载 `night-study-4.0.0-windows-portable.exe`，双击运行。

下载后可以对照 Release 中的 `SHA256SUMS.txt` 检查文件完整性。

## 快速开始

1. 打开「夜晚的书斋」。
2. 选择一份 PDF，或者把 PDF 拖进阅读区域。
3. 调节速度档位，让纸页按你的节奏向下流动。

### macOS 安全提示

如果 macOS 提示“无法验证开发者”，可以右键点击 `夜晚的书斋.app`，选择“打开”。这是未签名个人应用的常见提示。

### Windows 安全提示

如果 Windows SmartScreen 出现安全提示，可以选择“更多信息”后继续运行。正式签名版本会在后续考虑。

## 日夜图标

桌面版包含两枚图标：

- 日间图标：墨绿色，作为默认安装 / 打包图标；
- 夜晚图标：靛蓝色，作为夜间运行图标。

应用运行时会根据本地系统时间自动切换图标：

```text
06:00–18:00：日间图标
18:00–06:00：夜晚图标
```

这个切换只影响运行中的应用图标，不改变阅读界面主题，也不增加额外设置项。

## 源码运行

如果你想从源码运行，需要安装 [Node.js 18 或更高版本](https://nodejs.org/)。

### macOS

双击 `start-reader.command`，或在终端运行：

```sh
./start-reader.sh
```

也可以直接带文件启动：

```sh
./start-reader.sh "/path/to/document.pdf"
```

### Windows

双击 `start-reader.cmd`。它会打开阅读器界面，然后在页面中选择或拖入 PDF。也可以把 PDF 路径传给它。

## 功能

- 平滑自动滚动，启动和停止都有缓冲
- 4–64 像素/秒调速，分为“雪国朦胧”到“万物繁盛”六个档位
- 按当前页附近的文字密度，估算“字/分”和“词/分”，并显示以当前速度估算的剩余阅读时间
- 阅读回声首页：记录最近阅读、上次位置、上次速度和节奏回声
- 六档视觉背景：不同速度有不同背景色、图案和氛围；点击背景可在朦胧 / 清晰之间切换
- 切档音效：朦胧背景使用轻合成器提示音；清晰背景使用本地切档音效，并按顺序播放避免重叠
- 调整速度时有圆润的 `+N/-N` 文字粒子；系统开启“减少动画”后会自动停用
- 原生文字型 PDF 直接开放朗读；扫描件或图片页会自动用本地 OCR 补全当前页附近最多五页
- “希声”本地阅读陪伴：中文、英文、日文语音模型均随桌面版提供，首次朗读也不需要联网下载
- 六档朗读各有自己的行为：慢速逐字陪伴、快速过滤朗读、阅读线点读、段首句接力，以及最快两档的“点哪里读哪里”
- 中英、日英混排会分别选择适合的本地声音，再拼成连续语音
- 大型 PDF 按区间读取；打开时先出现纸页底稿，只渲染当前页附近的高清画布
- 缓存会按设备内存和页面像素量自动调整，跳页时取消旧位置的渲染与扫描任务
- 当前页码和阅读进度
- 可在阅读页内换另一份 PDF
- 阅读器长时无请求时，本地服务会自动退出
- 不联网，不上传文件

## 本地与隐私

阅读器只监听 `127.0.0.1`，PDF 文件不会上传。桌面版会在应用内部启动本地阅读服务；源码版会在系统浏览器中打开临时本地端口。

最近阅读、阅读位置、速度偏好、背景清晰度等“阅读回声”只保存在本机浏览器存储中。清除本机阅读回声不会删除 PDF 文件。

OCR 引擎和四个语言包约占 19 MB。普通文字型 PDF 直接使用原生文字层，不加载 OCR；当前页缺少可朗读正文时，阅读器才自动识别当前页附近，用户也可以点“扫描页增强”重新识别。OCR 同时补足朗读文字并改进速度估算，全程在本机完成，不会改变或上传 PDF。

桌面版还随包携带英文 q8 与中日文 v1.0 int8 Kokoro 模型、中文音素前端、Open JTalk 日文前端和字典。模型推理在独立 worker 进程中完成；停止朗读、跳页或更换文档时会真正终止旧推理。所有语音资源都在本机读取，不会把文字发送到外部服务。

通过启动器打开 PDF 时，本地服务支持 HTTP Range；通过页面选择或拖入文件时，浏览器使用 `File.slice()`。两种方式都不会为了显示第一页而先把整份大文件复制进 JavaScript 内存。页面停留后会以最高 DPR 2 渲染，离开缓存窗口的画布会被释放，纸页位置和文字统计则保留。

开发时可以在浏览器控制台运行 `window.__pdfFlowDiagnostics.snapshot()`，查看首屏时序、渲染/取消数量、画布像素预算、热区、数据来源和 OCR 状态。诊断数据只保留在当前本机页面中。

## 开发与构建

安装依赖：

```sh
npm install
```

首次构建正式桌面包前，准备锁定的 Python 3.12 CJK worker 与离线模型：

```sh
uv sync --project runtime/tts-multilingual --frozen
uv run --project runtime/tts-multilingual --frozen python scripts/build-multilingual-runtime.py
uv run --project runtime/tts-multilingual --frozen python scripts/prepare-english-model.py
```

模型由脚本从固定的官方地址下载，并在打包前校验 SHA-256；大文件不会提交进 Git。

运行永久回归测试：

```sh
npm test
```

启动 Electron 桌面版开发预览：

```sh
npm run app:start
```

生成可双击运行的桌面 build 文件夹：

```sh
npm run app:dir
```

生成发布用压缩包或安装包：

```sh
npm run app:dist
```

## 更新日志

版本更新记录见 [`CHANGELOG.md`](./CHANGELOG.md)。

## 技术说明

界面使用原生 HTML、CSS 和 JavaScript，PDF 渲染由 [Mozilla PDF.js](https://github.com/mozilla/pdf.js) 完成，可选文字识别由 [Tesseract.js](https://github.com/naptha/tesseract.js) 完成。桌面分发由 [Electron](https://www.electronjs.org/) 与 [electron-builder](https://www.electron.build/) 完成。本项目代码采用 MIT License；第三方许可详见 `THIRD_PARTY_NOTICES.md`。

## 许可

MIT © 2026 jinming4869
