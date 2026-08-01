# 模型资产清单

这些文件只存在于 gitignored `models/`，总计 `517,999,965` bytes（约 494 MiB）。

| 文件 | Bytes | SHA-256 | 来源 |
|---|---:|---|---|
| `kokoro-v1.1-zh.onnx` | 343,605,188 | `eefec708cbc7aba8e8129b5c2f7cb92e1fe7d281af1e1dd451592d9ff0714a0d` | `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.1-zh.onnx` |
| `voices-v1.1-zh.bin` | 53,815,880 | `14cb6186c99e4f6016871405f62046c5df863ae27465cbdc4ee08be7dd703acd` | `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.1-zh.bin` |
| `config-v1.1-zh.json` | 3,228 | `bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890` | 官方：`https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/main/config.json`；本次网络回退：`https://hf-mirror.com/hexgrad/Kokoro-82M-v1.1-zh/resolve/main/config.json` |
| `kokoro-v1.0.int8.onnx` | 92,361,271 | `6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb` | `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx` |
| `voices-v1.0.bin` | 28,214,398 | `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d` | `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin` |

## 首次准备的其他资源

- Python `.venv`：约 425 MiB。
- Open JTalk 日文字典：107,304,813 bytes，位于 `pyopenjtalk` 包目录。
- 若最终选择中日共用 v1.0 int8，可不分发 v1.1 中文三件套，模型资产降至约 115 MiB。

## 许可证检查点

- `kokoro-onnx`：MIT；Kokoro 模型：Apache-2.0。
- `misaki-fork`：Apache-2.0；`pyopenjtalk`、`onnxruntime`：MIT。
- `phonemizer-fork`：GPL-3.0-or-later；`espeakng-loader` 内含 eSpeak NG 动态库和数据。正式发布前必须决定是按 GPL 要求作为独立 child component 分发并提供相应材料，还是在生产适配器中移除这条依赖。本文不作法律结论。
