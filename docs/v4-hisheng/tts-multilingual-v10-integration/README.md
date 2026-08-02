# 中日文 TTS v1.0 集成摘要

本目录记录中文、日文离线朗读接入应用的架构、资源边界与验证依据。

## 架构

- 英文保留 `kokoro-js` 本地 worker。
- 中文与日文共用 Kokoro v1.0 int8 模型和独立 CJK worker。
- Node 路由器按文字脚本与语言提示分发请求。
- 中英、日英混排分别合成后拼接为 PCM16 WAV。
- 活动请求取消时终止旧 worker，后续请求按需重建。

## 资源发现

正式应用只从显式环境变量、安装包资源目录或开发资源目录读取模型。模型、虚拟环境、字典缓存和生成音频不进入 Git。

模型地址、字节数和 SHA-256 见 [`MODEL_ASSETS.md`](../../../experiments/tts-multilingual-poc/MODEL_ASSETS.md)。正式发布包的运行时组成见项目根目录 [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md)。

## 验证

集成测试覆盖：

- 中文、日文与英文路由
- 连续速度
- 混排文本
- 实际 voice、model、dtype 与 sample rate 元数据
- HTTP 取消、worker 终止和重建
- 本地模型缺失时的明确错误

当前发布状态与测试数量以 [`CHANGELOG.md`](../../../CHANGELOG.md) 和 GitHub Actions 为准。
