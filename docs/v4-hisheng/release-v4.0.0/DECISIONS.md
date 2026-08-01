# v4.0.0 发布决定

## D1：CJK 正式包不分发 eSpeak/phonemizer

决定：正式 CJK worker 不依赖 `kokoro-onnx`、`phonemizer-fork` 或 `espeakng-loader`，只使用 ONNX Runtime、NumPy、Misaki 中文/日文前端与 pyopenjtalk。

理由：中日文 G2P 本身不需要 eSpeak。直接保留 eSpeak 会显著增加打包复杂度，并引入 GPL 分发边界；小型 ONNX 调用器足以完成已经验证的 `tokens/style/speed` 推理协议。

## D2：混排英文交给英文 worker

决定：中文或日文句子中的拉丁字母片段由现有 `kokoro-js` 英文 worker 朗读，中日文片段由 CJK worker 朗读，最后在 Node 侧拼接同格式 WAV。

理由：相比删除英文、让中文前端猜读或引入 eSpeak，这一方案保留可理解的英文发音，并沿用已存在的本地模型。

## D3：用 PyInstaller onedir 分发 CJK worker

决定：每个平台在 GitHub Actions 上用 Python 3.12 构建 PyInstaller onedir worker，再作为 Electron `extraResources` 打包。

理由：venv 路径不可可靠搬运；onedir 能携带解释器、ONNX Runtime 原生库与 pyopenjtalk 数据。PyInstaller 的 Bootloader Exception 明确允许把 bootloader 嵌入并分发到组合程序。

## D4：模型在 CI 下载并固定哈希

决定：模型大文件不提交 Git；构建脚本从固定 v1.0 Release URL 下载，并在进入包之前强制校验 SHA-256。

理由：保持源码仓库轻量，同时令构建输入可审计、失败可诊断。

## D5：发布前只支持两个正式桌面目标

决定：v4.0.0 正式资产为 macOS Apple Silicon zip 与 Windows x64 portable exe。

理由：与当前 README 和既有 Release 口径一致；Intel macOS、Linux、签名/公证留待后续版本。

## D6：英文模型也必须随包、禁止远端回退

决定：构建时下载并校验 `onnx-community/Kokoro-82M-ONNX` 的 q8 模型、配置和 tokenizer；worker 将 Transformers.js 的 `allowRemoteModels` 设为 `false`。

理由：只把 CJK 做成离线仍会让英文首次朗读依赖网络，与“本地阅读陪伴”和隐私承诺冲突。模型缺失时应给出明确的安装损坏错误，而不是暗中联网。

## D7：语音路由边界统一为 PCM16

决定：英文 worker 将 Kokoro/Transformers.js 的 float32 波形限幅并量化为 24 kHz mono PCM16 WAV；路由器只拼接已统一的 PCM16 分段。

理由：CJK worker 输出 PCM16，而 `RawAudio.toWav()` 默认是 IEEE float32。在各 worker 的边界先统一格式，可以让纯英文与混排路径共用同一套可验证的音频合约。
