# 缓缓读 PDF

一个很轻的 Windows PDF 阅读器。打开文件后，页面会以舒缓的速度自动向下移动，不用一直滚鼠标。

它适合读论文、报告和长文档。PDF 只在本机处理，不会上传到任何服务器。

## 使用方法

1. 安装 [Node.js 18 或更高版本](https://nodejs.org/)。
2. 下载并解压本项目。
3. 双击 `start-reader.cmd`，选择一份 PDF。

也可以把 PDF 文件直接拖到 `start-reader.cmd` 上。

打开后会自动开始滚动。页面底部可以暂停、继续或调整速度；按空格键也能切换暂停状态。切换到其他标签页时，滚动会暂缓，回来后继续。

## 功能

- 平滑自动滚动，启动和停止都有缓冲
- 5–55 像素/秒调速
- 当前页码和阅读进度
- 可在阅读页内换另一份 PDF
- 页面关闭约 3 分钟后，本地服务自动退出
- 不联网，不上传文件

## 本地运行

```powershell
./start-reader.ps1 "C:\path\to\document.pdf"
```

阅读器只监听 `127.0.0.1`，浏览器通过临时本地端口访问。项目没有 npm 依赖，PDF.js 的运行文件已经放在 `vendor/` 目录里。

## 技术说明

界面使用原生 HTML、CSS 和 JavaScript，PDF 渲染由 [Mozilla PDF.js](https://github.com/mozilla/pdf.js) 完成。本项目代码采用 MIT License；PDF.js 采用 Apache License 2.0，详见 `THIRD_PARTY_NOTICES.md`。

## 许可

MIT © 2026 jinming4869
