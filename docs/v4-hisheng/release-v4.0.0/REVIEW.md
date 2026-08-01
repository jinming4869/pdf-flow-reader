# v4.0.0 发布复核

状态：本地候选包通过；等待跨平台 CI 与 GitHub Release 证据。

## 已通过

- 计划符合性：产物、平台、模型、非目标与 `PLAN.md` 一致。
- 许可边界：正式 CJK runtime 不含 `phonemizer-fork`、eSpeak、`kokoro-onnx`；可分发依赖和 PyInstaller Bootloader Exception 已记入第三方声明。
- 回归：`npm test` 通过 289/289；Python worker 通过 5/5。
- 真实模型：打包后中英混排、日英混排和纯英文均产生 24 kHz mono PCM16 WAV。
- 取消语义：打包后的 CJK worker 在 AbortSignal 后被硬终止，随后请求可以重建并生成音频。
- 打包完整性：自包含 CJK worker、英文模型、日文字典；未夹带内部发布文档、临时 runtime 构建树、`onnxruntime-web`、Transformers 开发源码或多余声音。
- macOS 候选包：392,989,571 bytes，SHA-256 `d2771f0da4a6de263cfc12c0393c3c668b16aed7901e7ceec8a5bb62de1731ab`。
- 用户文件保护：`docs/COMPETITOR_RESEARCH_SPIEL_LOCAL_TTS_2026-07-25.md` 仍为未暂存的用户改动，明确排除于发布提交与远端上传。

## 尚待远程验收

- GitHub Actions 上 macOS Apple Silicon 与 Windows x64 均重建 runtime、重跑测试和包内 smoke。
- PR #1 通过后合并，`v4.0.0` tag 只指向已验收的 `main`。
- Release 必须同时含 macOS zip、Windows portable exe 和 `SHA256SUMS.txt`，且校验和附件一致。
