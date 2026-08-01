# v4.0.0 发布上下文

## 当前状态

- 本地分支：`feature/v4-hisheng`
- 版本已固定为 `4.0.0`，本地开发和打包边界已完成。
- Node 回归 `289/289`，Python worker 回归 `5/5`。
- macOS Apple Silicon 候选包已验证中英、日英、纯英文 24 kHz mono PCM16 WAV，以及硬取消后 worker 重建。
- 当前候选 ZIP：`dist/night-study-4.0.0-mac-arm64.zip`，392,989,571 bytes，SHA-256 `d2771f0da4a6de263cfc12c0393c3c668b16aed7901e7ceec8a5bb62de1731ab`。
- draft PR #1 尚待更新；提交后以 macOS/Windows GitHub Actions 作为最终跨平台验收。

## 已验证的本地资产

| 文件 | 大小 | SHA-256 |
|---|---:|---|
| `kokoro-v1.0.int8.onnx` | 92,361,271 bytes | `6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb` |
| `voices-v1.0.bin` | 28,214,398 bytes | `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d` |
| English `model_quantized.onnx` | 92,360,543 bytes | `0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556` |

来源为 `thewh1teagle/kokoro-onnx` 的官方 `model-files-v1.0` GitHub Release；模型项目 `hexgrad/Kokoro` 使用 Apache-2.0。

## 风险

- 开发 PoC 安装了 `kokoro-onnx`，它会传递安装 GPL-3.0 的 `phonemizer-fork` 与 eSpeak 资源。
- Python venv 不适合直接跨机器搬运，必须把解释器和二进制依赖一并封装。
- pyopenjtalk 首次使用会准备约 100 MB Open JTalk 字典，构建时必须预热并收集数据。
- macOS 与 Windows 的本地原生扩展不同，必须分别在对应 runner 构建。
- 当前环境的 Git smart HTTP 到 GitHub 不稳定；如仍不可用，继续通过 `gh api` 更新远端 Git tree。
- 原有 `kokoro-js` 默认允许 Hugging Face 远端回退；正式 worker 已改为只接受随包携带的本地模型目录。

- `Transformers.js` 的 `RawAudio.toWav()` 输出 IEEE float32 WAV；正式英文 worker 现在边界内转为 PCM16，再与 CJK WAV 拼接。

## 受保护的用户文件

`docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 有用户本地改动。发布过程中不得修改、暂存、提交或上传该改动。
