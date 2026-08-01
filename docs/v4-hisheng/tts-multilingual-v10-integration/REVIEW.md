# 复核记录

## 结论

本地开发工程接线通过，PLAN.md 八条验收标准均有代码和测试证据。没有阻止本阶段合并的 P0 / P1。跨平台发布资源与许可证处理仍是明确的后续阶段，不计作本地接线缺陷。

## 验收映射

1. 中文：真实 HTTP 返回 24 kHz WAV、`zh / zf_xiaobei / kokoro-v1.0.int8.onnx / int8`。
2. 日文：输入只有 `cjk` 提示但含假名时，真实 HTTP 自动改路由为 `ja / jf_alpha`。
3. 英文：路由测试证明纯拉丁文本仍进入原 `tts-runtime-client.mjs`；原 worker 队列、崩溃恢复与取消测试全部保留。
4. 连续速度：同一中文中英混排句经正式 HTTP 链分别以 1.0、1.25、1.5、1.85 合成；WAV 字节数随速度上升从 293,932 降至 163,884，四次未知音素均为 0。
5. 硬取消：冒烟脚本先观察到 `multilingual: busy`，再中断 HTTP，得到 `AbortError`；随后新 worker 连续完成余下四次合成。单测同时确认 `SIGKILL` 和父进程临时目录清理。
6. 元数据：服务端与前端 provider 已传递实际 `language / voice / model / dtype / speed / sampleRate`，不再用英文 `af_heart` 冒充 CJK。
7. 回归：Node 280/280；PoC Python 12/12；正式 worker Python 4/4；`git diff --check` 通过；真实冒烟脚本通过。
8. 隔离：用户文件 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 未被编辑、暂存或纳入本轮提交。

## 真实产物

- 中文：`output/speech/integration-v10/zh-v10-http-1.wav`、`-125.wav`、`-15.wav`、`-185.wav`。
- 日文：`output/speech/integration-v10/ja-v10-http-125.wav`。
- 机器可读清单：`tmp/speech/integration-v10/manifest.json`。

试听层面的音色选择已由用户在 PoC 对照后完成；本轮额外检查 RIFF/WAV、采样率、连续速度、脚本路由和未知音素，不以自动指标冒充主观听感。

## 残余边界

- 只有汉字、没有假名且缺少明确语言元数据的日文短标题，单凭 `cjk` 无法可靠区别中日文，当前会保守落到中文。普通日文句子含假名时可正确识别；未来应把页面/文档级语言结论传进 ReadableChunk。
- 现有发布包尚未包含 Python runtime、约 115 MiB 的共享模型和 Open JTalk 字典。本轮只保证当前本地开发工程可用。
- `phonemizer-fork` 为 GPL-3.0-or-later，eSpeak NG 也需完整核对。发布前必须完成独立 child component 的合规材料或移除这条依赖；本记录不构成法律意见。
