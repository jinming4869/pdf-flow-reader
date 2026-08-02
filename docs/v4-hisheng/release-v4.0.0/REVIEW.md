# v4.0.0 发布验证

状态：发布流水线与 Release 资产均已完成。

## 已验证

- 构建产物、平台和模型与发布契约一致。
- CJK runtime 不包含 `phonemizer-fork`、eSpeak 或 `kokoro-onnx`。
- Node 回归 289 项通过，Python worker 回归 5 项通过。
- 包内中英混排、日英混排和纯英文均生成 24 kHz mono PCM16 WAV。
- 活动 CJK 推理可以硬取消，后续请求能重建 worker。
- 桌面包包含 CJK worker、英文模型和日文字典。
- macOS 与 Windows 在各自 GitHub Actions runner 上完成构建与冒烟测试。
- Release 同时包含 macOS zip、Windows portable exe 和 `SHA256SUMS.txt`。

## 许可与运行边界

- 可分发依赖与 PyInstaller Bootloader Exception 已记录在第三方声明中。
- 模型通过固定地址、大小和 SHA-256 约束。
- 英文运行时禁止远端模型回退。
- 当前发布包未签名，也未进行 macOS 公证或 Windows Authenticode 签名。

最终资产与校验值以 GitHub Release 页面为准。
