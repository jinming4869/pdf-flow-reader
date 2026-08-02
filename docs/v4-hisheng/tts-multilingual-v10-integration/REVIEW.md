# 中日文 TTS 集成验证

## 结论

中文、日文与英文路由、连续速度、混排、取消和 worker 重建均已通过自动化与真实 HTTP 冒烟测试，并进入 v4.0.0 正式发布路径。

## 验证范围

1. 中文返回 `zf_xiaobei`、Kokoro v1.0 int8 和 24 kHz WAV。
2. 含假名文本能够自动进入日文 `jf_alpha` 路径。
3. 纯拉丁文本继续使用英文 worker。
4. 中文连续速度会产生对应时长变化，混排片段无未知音素。
5. HTTP 中断会终止活动 CJK worker，后续请求能够重建。
6. 服务端和前端传递实际 `language`、`voice`、`model`、`dtype`、`speed` 与 `sampleRate`。
7. Node、PoC Python、正式 worker Python 与真实冒烟测试全部通过。

## 保留边界

- 只有汉字且缺少语言元数据的短日文标题，可能保守路由为中文。
- 自动指标只能验证波形、速度、元数据和路由，不能替代主观音色判断。
- 模型与文本前端仍可能产生发音误差。

正式运行时的许可与资源组成见 [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md)。
