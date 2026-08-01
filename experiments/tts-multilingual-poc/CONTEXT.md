# 上下文

## 已确认故障

应用当前依赖 `kokoro-js@1.2.1` 和 `onnx-community/Kokoro-82M-ONNX` q8。运行时只真正支持英语音素化与英语音色；现有 provider 虽声明 `zh` / `ja`，实际仍把文本送给英语 G2P 和 `af_heart`。结果是中文反复朗读 “Chinese letter”，日文反复朗读 “Chinese letter / Japanese letter”。

## 已确认的不变项

- 现有英文语音质量和性能可接受，先保留。
- 现有调度、预加载、WAV 播放及跳页硬取消能力应在正式接线时复用。
- 先证明语言前端和模型适配，不在同一阶段改 UI、阅读模式或速度档位。
- 用户自己的 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 改动受保护，不得修改或暂存。

## 当前硬件与基线

- 测试机器：Apple M4，16 GB 内存。
- 现有英语 worker 热合成约 1.6–2.4 秒，音频约 4.2–6.4 秒；worker RSS 约 833 MB。
- PoC 应同时报告绝对结果和相对该基线的差异。

## PoC 暴露的路径兼容问题

在包含中文字符的工程路径下，`espeakng-loader==0.2.4` 的 macOS 动态库无法从 Unicode 数据路径读取 `phontab`，会错误回退到其构建机的 `/Users/runner/work/...` 路径并直接退出。相同文件经 ASCII 临时目录下的软链接访问时，`espeak_Initialize` 正常返回。PoC 因而必须在 child process 内为 eSpeak 建立 ASCII shadow path。
