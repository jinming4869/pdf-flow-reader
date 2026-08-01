# 中日文 TTS v1.0 正式接线计划

## 目的

让“希声”在本地应用内正确朗读中文与日文，同时保留已经稳定的英文 Kokoro JS 链路。中日文使用用户选定的 Kokoro v1.0 int8，不联网、不阻塞 HTTP 服务，并继承已经验证过的硬取消语义。

## 范围

- 英文：保留 `kokoro-js` + `af_heart` / `bf_emma`。
- 中文：Kokoro v1.0 int8 + legacy Misaki `ZHG2P()` + `zf_xiaobei`。
- 日文：同一 v1.0 int8 + `JAG2P(version="pyopenjtalk")` + `jf_alpha`。
- 中英混排：中文前端处理汉字、数字与标点，英文片段交给 eSpeak G2P 后合并音素。
- 进程：Node 路由器按语言分发；中日文进入常驻 Python child process；取消活动请求时直接终止 child。
- 本阶段只完成本地开发工程接线。跨平台 Python runtime、模型下载/随包策略与许可证发布方案留到发布工程阶段。

## 验收标准

1. `cjk` 中文文本实际返回 `zf_xiaobei` 的 24 kHz WAV。
2. 含平假名/片假名的 `cjk` 文本实际路由到日文 `jf_alpha`。
3. 纯英文仍走现有 JS worker，既有行为和测试不回退。
4. 中文支持 1.0、1.25、1.5、1.85 的连续速度；中英混排不产生未知音素。
5. HTTP 客户端中断会硬终止正在推理的 Python child；下一请求能重建并成功。
6. `/tts/kokoro` 返回实际模型、voice、language、speed 元数据。
7. Node 全量测试、Python 单测和真实 HTTP 中日文冒烟测试通过。
8. 不修改或提交用户文件 `docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md`。

## 非目标

- 不替换或重新训练模型。
- 不在本阶段制作 macOS / Windows 可发布安装包。
- 不引入在线 TTS，也不修改六档产品朗读策略。
- 不把 PoC 的 v1.1 中文模型打入正式资源。
