# 缓缓读 PDF

> 让 PDF 阅读和轻吻纸质书一样好玩。

一个本地、轻量的 PDF 连续阅读器。打开后，页面会以可调的速度自动向下移动，让论文、报告和长文档读起来少一点手动操作。PDF 只在本机处理，不会上传。

## 快速开始：桌面版

普通用户建议直接下载 GitHub Releases 里的桌面版压缩包，而不是下载源码。

### macOS

1. 下载 macOS 版本压缩包并解压。
2. 双击 `缓缓读 PDF.app`。
3. 在页面中选择 PDF，或者直接把 PDF 拖进阅读区域。

如果 macOS 提示“无法验证开发者”，可以右键点击 `缓缓读 PDF.app`，选择“打开”。这是未签名个人应用的常见提示。

### Windows

1. 下载 Windows 版本压缩包并解压。
2. 双击 `缓缓读 PDF.exe`。
3. 在页面中选择 PDF，或者直接把 PDF 拖进阅读区域。

如果 Windows SmartScreen 出现安全提示，可以选择“更多信息”后继续运行。正式签名版本会在后续考虑。

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
- 按当前页附近的文字密度，估算“字/分”和“词/分”
- 调整速度时有圆润的 `+N/-N` 文字粒子；系统开启“减少动画”后会自动停用
- 扫描件或图片页可选本地 OCR，识别当前页前后最多五页，让“字/分、词/分”估算更准
- 大型 PDF 按区间读取；打开时先出现纸页底稿，只渲染当前页附近的高清画布
- 缓存会按设备内存和页面像素量自动调整，跳页时取消旧位置的渲染与扫描任务
- 当前页码和阅读进度
- 可在阅读页内换另一份 PDF
- 阅读器长时无请求时，本地服务会自动退出
- 不联网，不上传文件

## 本地与隐私

阅读器只监听 `127.0.0.1`，PDF 文件不会上传。桌面版会在应用内部启动本地阅读服务；源码版会在系统浏览器中打开临时本地端口。

OCR 引擎和四个语言包约占 19 MB。它们只在点击页面边缘的“扫描页增强估算”后加载，不会影响普通文字型 PDF 的启动。普通文字 PDF 通常不需要开启；扫描识别只用于改进阅读速度估算，全程在本机完成，不会改变或上传 PDF。

通过启动器打开 PDF 时，本地服务支持 HTTP Range；通过页面选择或拖入文件时，浏览器使用 `File.slice()`。两种方式都不会为了显示第一页而先把整份大文件复制进 JavaScript 内存。页面停留后会以最高 DPR 2 渲染，离开缓存窗口的画布会被释放，纸页位置和文字统计则保留。

开发时可以在浏览器控制台运行 `window.__pdfFlowDiagnostics.snapshot()`，查看首屏时序、渲染/取消数量、画布像素预算、热区、数据来源和 OCR 状态。诊断数据只保留在当前本机页面中。

## 开发与构建

安装依赖：

```sh
npm install
```

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
