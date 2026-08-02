# 多语言 TTS PoC 背景

早期应用依赖 `kokoro-js@1.2.1` 与英文 Kokoro q8 运行时。中文和日文会经过英语音素化与英语音色，无法形成可用的本地多语言朗读。

## 实验目标

- 保留已经稳定的英文链路。
- 验证 Kokoro ONNX 与 Misaki 的中文、日文前端。
- 使用持久 child process，并验证活动推理可以硬取消。
- 同时报告延迟、RTF、内存、离线能力和资源体积。
- 不在 PoC 阶段修改 UI、阅读策略或正式发布包。

## 基线

现有英语 worker 热合成约 1.6–2.4 秒，音频约 4.2–6.4 秒，worker RSS 约 833 MB。实验结果同时记录绝对值与相对基线差异；具体机器身份不作为公开结论的一部分。

## 路径兼容

`espeakng-loader==0.2.4` 的 macOS 动态库在非 ASCII 工程路径中可能无法读取 `phontab`，并错误回退到构建机路径。PoC 在 child process 内建立临时 ASCII shadow path，使同一数据目录能够正常初始化。正式 v4 CJK runtime 后续移除了 eSpeak 依赖。
