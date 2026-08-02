# 决策记录

## 2026-07-31：采用方案 A

采用“现有英文链路 + Kokoro ONNX / Misaki 中日文链路”。先做隔离 PoC，通过后再讨论正式接入。

## 模型选择

- 中文选择 Kokoro v1.1-zh 官方 ONNX：官方示例明确要求 `ZHG2P(version="1.1")`、中文模型、中文 voices 和 `config.json`。
- 日文选择 Kokoro v1.0 int8：官方日文示例使用 v1.0 与 `jf_alpha`；PoC 优先使用约 92 MB 的官方 int8 资产控制体积。
- 中文 v1.1 官方 release 暂无 int8 资产，PoC 先使用约 344 MB 的原始 ONNX，是否自行量化留待验证后决定。

## 日文前端

使用 `JAG2P(version="pyopenjtalk")`，而不是该发行包仍保留的 `cutlet` 默认值。实测第二代前端只需首次下载约 23.6 MB 的 Open JTalk 字典即可工作；默认 `JAG2P()` 会因未安装完整 UniDic 数据而初始化失败。官方示例省略 `version` 参数与当前包行为不一致，PoC 显式指定以保证可复现。

## 依赖选择

- `kokoro-onnx==0.5.0`：MIT。
- `misaki-fork==0.9.6`：Apache-2.0，且是 `kokoro-onnx` 当前中日文示例指定的发行包。
- Python 3.12：同时满足 `kokoro-onnx <3.14` 和 `misaki-fork <3.13`。

## 进程模型

PoC 使用持久 Python child process，并由 Node 父进程拥有其生命周期。推理中的取消采用终止 child process 的硬取消语义；后续请求按需重建 worker。这样取消能真正终止 ONNX 推理，而不是只丢弃前端结果。

## 暂不决定

- 中文模型是否量化、量化后的音质门槛。
- 中日文资源是随安装包附带，还是首次使用时按语言下载。
- 正式接线后的跨语言混排拆句策略。
- `2.5x` 产品速度与当前服务端 `1.85x` 上限的统一方式。

## 2026-07-31：中文必须使用外部 v1.1 词表

包内默认词表虽含四声箭头，却缺少 v1.1 中文前端产生的注音和汉字音素。实测用包内词表时，一句八字中文只剩标点三个 token，并生成异常的 0.30 秒音频。外部配置含 171 个词表项，测试音素中的 `ㄑ`、`ㄧ`、`ㄓ`、`言`、`十`、`应` 均有 token。PoC 保留官方 Hugging Face URL，并在官方域名不可达时使用 `hf-mirror.com` 下载；文件 SHA-256 固定为 `bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890`。

## 2026-07-31：为 eSpeak 建立 ASCII shadow path

`espeakng-loader==0.2.4` 的 macOS 动态库在非 ASCII 工程路径下无法加载 `phontab`，并回退到发布者构建机路径后退出。将同一数据目录软链接到 ASCII 临时目录、把该目录传给 `espeak_Initialize` 后可以正常初始化。worker 启动时自动创建隔离 shadow path，不要求移动项目，也不依赖系统级 eSpeak。

## 2026-07-31：正式集成选择中文 v1.0

对照结果确定采用 `kokoro-v1.0.int8.onnx`、`voices-v1.0.bin` 与 `zf_xiaobei`；日文继续使用同一模型与 `jf_alpha`。这一组合保留 1.0–1.85x 的连续速度控制，并把中日文模型资产从 v1.1 + v1.0 的约 494 MiB 降为共用 v1.0 的约 115 MiB。v1.1 中文三件套不进入正式接线和后续分发范围。
