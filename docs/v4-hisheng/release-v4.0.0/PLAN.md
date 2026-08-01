# v4.0.0「希声」正式发布计划

## 目的

把当前可开发运行的 v4 工程补齐为普通用户下载后即可离线使用的正式桌面版本，并发布到 `jinming4869/pdf-flow-reader`。

## 发布范围

- 产品版本：`v4.0.0`
- Release 名称：`夜晚的书斋 v4.0.0 — 希声`
- 平台：macOS Apple Silicon、Windows x64
- 发布渠道：GitHub Release
- 语音：英文 JavaScript worker；中文 `zf_xiaobei`；日文 `jf_alpha`
- 模型：英文 Kokoro q8，以及中日文 Kokoro v1.0 int8 ONNX 与 v1.0 voices，全部随桌面包离线分发

## 执行顺序

1. 固化发布边界、第三方许可和可复现构建输入。
2. 移除 CJK 正式运行时对 `phonemizer-fork` / eSpeak 的依赖。
3. 将中文或日文句子中的英文片段路由到现有英文 worker，并拼接 PCM WAV。
4. 用 PyInstaller onedir 生成自包含 CJK worker，预装 Open JTalk 日文字典。
5. 固化 kokoro-js 英文模型到只读本地模型目录，禁止运行时远端回退。
6. GitHub Actions 自动下载并校验模型、构建双平台运行时和 Electron 包。
7. 更新版本号、README、CHANGELOG、第三方声明和发布说明。
8. 完成单测、真实中英日语音、macOS 打包与安装包离线冒烟。
9. 更新 draft PR，等待双平台 CI；独立复核通过后合并、打 tag、发布 Release。

## 发布门槛

- `npm test` 全绿。
- Python worker 单测全绿。
- 中文、日文、英文以及中英/日英混排均生成可解析的 24 kHz mono PCM16 WAV。
- 中断推理会杀死旧进程，下一请求能重建成功。
- 打包后的应用不依赖系统 Python，不包含 `phonemizer-fork`、eSpeak 或 `kokoro-onnx`，英文模型也不在首次使用时联网下载。
- macOS 构建可以在断网状态调用已打包 CJK worker。
- Windows GitHub Actions 构建、测试、打包均通过。
- Release 同时包含 macOS zip、Windows portable exe 和 `SHA256SUMS.txt`。
- 本地未提交的竞争对手调研文档不进入提交或 Release source tree。

## 非目标

- 本版不更换 Kokoro 模型或声音。
- 本版不加入云端 TTS。
- 本版不做代码签名、公证或自动更新。
- 本版不新增音乐或大范围主题色变化。
