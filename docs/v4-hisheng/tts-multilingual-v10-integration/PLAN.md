# 中日文 TTS v1.0 集成契约

## 目的

让应用在本机正确朗读中文与日文，同时保留既有英文链路、HTTP 响应性与硬取消语义。

## 范围

- 英文：`kokoro-js` 本地 worker
- 中文：Kokoro v1.0 int8、Misaki 中文前端、`zf_xiaobei`
- 日文：Kokoro v1.0 int8、pyopenjtalk 日文前端、`jf_alpha`
- 混排：按脚本拆分，中日文进入 CJK worker，拉丁文本进入英文 worker
- 进程：Node 路由器与独立子进程，单并发且可硬取消

## 验收标准

1. 中文、日文和英文返回有效的 24 kHz WAV。
2. 假名文本能够自动路由到日文。
3. 纯英文路径与既有测试不回退。
4. 中文支持产品需要的连续速度。
5. 客户端中断会停止活动推理，下一请求可以重建。
6. 服务返回实际模型、voice、language、speed 和 sample rate。
7. Node、Python 与真实 HTTP 冒烟测试通过。
8. 模型、虚拟环境和生成音频不进入 Git。

## 非目标

- 重新训练模型
- 引入云端 TTS
- 修改六档产品策略
