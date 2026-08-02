# v4.0.0 发布摘要

v4.0.0 将中文、英文和日文离线朗读正式打入桌面包，并完成双平台发布。

## 发布范围

- macOS Apple Silicon zip
- Windows x64 portable exe
- `SHA256SUMS.txt`
- 英文 Kokoro q8 模型
- 中日文 Kokoro v1.0 int8 模型与声音
- 自包含 CJK worker 和 Open JTalk 日文字典

## 验证基线

- Node 回归：289 项通过
- Python worker 回归：5 项通过
- 中英、日英与纯英文均生成 24 kHz mono PCM16 WAV
- 活动推理取消后，worker 可以安全重建
- GitHub Actions 在 macOS 与 Windows 上分别构建原生运行时

## 固定模型资产

| 文件 | 大小 | SHA-256 |
|---|---:|---|
| `kokoro-v1.0.int8.onnx` | 92,361,271 bytes | `6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb` |
| `voices-v1.0.bin` | 28,214,398 bytes | `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d` |
| English `model_quantized.onnx` | 92,360,543 bytes | `0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556` |

模型在构建阶段从固定地址下载，并在打包前校验大小和哈希；模型大文件不进入 Git。

## 发布边界

- CJK 正式运行时不分发 `phonemizer-fork`、eSpeak 或 `kokoro-onnx`。
- 英文运行时禁用远端模型回退。
- Python 原生扩展在目标平台分别构建，不跨平台搬运虚拟环境。
- 当前版本未进行代码签名、公证或自动更新。
