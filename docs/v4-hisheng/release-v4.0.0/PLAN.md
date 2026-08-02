# v4.0.0 发布契约

本文记录 v4.0.0 的发布范围、构建步骤和验收门槛。

## 发布目标

- 产品版本：v4.0.0
- Release 名称：夜晚的书斋 v4.0.0 — 希声
- 平台：macOS Apple Silicon、Windows x64
- 渠道：GitHub Releases
- 语音：中文、英文和日文全部离线运行

## 构建步骤

1. 使用锁文件安装 Node 与 Python 依赖。
2. 下载并校验固定模型资产。
3. 在目标平台构建自包含 CJK worker。
4. 准备仅使用本地文件的英文模型目录。
5. 运行 Node 与 Python 回归测试。
6. 构建 Electron 桌面包。
7. 对包内模型和 worker 运行离线冒烟测试。
8. 汇总双平台资产并生成 SHA-256 校验文件。

## 发布门槛

- 中文、日文、英文和混排文本均生成有效 PCM16 WAV。
- 取消推理后旧进程停止，下一请求可重建。
- 包内不依赖系统 Python，也不会在首次使用时远程下载模型。
- 双平台构建和打包后冒烟测试全部通过。
- Release 同时包含 macOS zip、Windows portable exe 与 `SHA256SUMS.txt`。

## 本版不包含

- 云端 TTS
- 代码签名与平台公证
- 自动更新
- Intel macOS 或 Linux 正式资产
