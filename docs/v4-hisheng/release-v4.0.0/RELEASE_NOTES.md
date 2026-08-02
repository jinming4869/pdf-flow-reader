# 夜晚的书斋 v4.0.0 — 希声

> 让 PDF 阅读和轻吻纸质书一样好玩。

“希声”让朗读真正成为阅读节奏的一部分。它不会用同一种播报方式盖住所有页面，而会在六个速度档位中改变自己的角色：慢时陪你逐字走，稍快时过滤枝节追上纸页，中速时只在你按下乐符时读眼前一句，再快时用自然段段首句接力；最快两档则把决定权交给点击——点哪里，读哪里。

## 这次最重要的变化

- 中文、英文、日文语音全部在本机运行，模型已随桌面包提供，首次朗读也不需要额外下载。
- 原生 PDF 文字够好时直接开放希声；扫描页或文字不足时，自动识别当前页附近最多五页。
- 中英、日英混排会分别选择适合的声音，再在本机拼成连续语音。
- 跳页、停止和更换文档会真正终止旧模型推理，不再出现已经离开的句子迟到播放。
- 朗读运行在独立 worker 中，不阻塞 PDF 渲染、Range 读取和本地服务心跳。
- 修复 OCR 调度饿死、`R` 绕过门槛、纯英文页面误显示“字/分”等基础问题。

## 下载

- macOS Apple Silicon：`night-study-4.0.0-mac-arm64.zip`
- Windows x64：`night-study-4.0.0-windows-portable.exe`
- 完整性校验：`SHA256SUMS.txt`

模型、OCR、最近阅读和阅读位置均只在本机处理。应用不会上传 PDF 或朗读文字。

## 安全提示

本版本尚未购买开发者证书，因此 macOS 和 Windows 可能显示未签名应用提示。macOS 可右键应用并选择“打开”；Windows 可在 SmartScreen 中选择“更多信息”。

完整工程变更见 [CHANGELOG](https://github.com/jinming4869/pdf-flow-reader/blob/main/CHANGELOG.md)，第三方许可见 [THIRD_PARTY_NOTICES](https://github.com/jinming4869/pdf-flow-reader/blob/main/THIRD_PARTY_NOTICES.md)。
