# v4.0.0 发布 TODO

- [x] 建立发布工程的 source-of-truth 文件。
- [x] 核查核心模型、运行时和打包器许可。
- [x] 实现无 eSpeak 的 CJK ONNX worker。
- [x] 实现中英/日英混排分段与 WAV 拼接。
- [x] 实现并锁定 PyInstaller 构建脚本。
- [x] 固化并校验英文离线模型，禁止远端回退。
- [x] 让 Electron 自动携带 worker、模型和日文字典。
- [x] 更新版本、README、CHANGELOG、第三方声明和 Release notes。
- [x] 运行完整测试与真实多语种音频冒烟。
- [x] 构建并离线验证 macOS 正式包。
- [ ] 更新 draft PR，等待 macOS/Windows CI。
- [ ] 完成独立发布复核并修正问题。
- [ ] 合并、打 `v4.0.0` tag、创建 Release。
- [ ] 验证 Release 资产与 SHA256SUMS。
