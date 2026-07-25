# 夜晚的书斋 v3.0.0

v3.0.0 的关键词是“回声”。这一版把阅读记忆、节奏仪表、视觉背景和切档音效合成一个更完整的本地节奏阅读体验。

## 下载

- macOS Apple Silicon: `night-study-3.0.0-mac-arm64.zip`
- Windows portable: `night-study-3.0.0-windows-portable.exe`
- 校验文件: `SHA256SUMS.txt`

## 主要变化

- 阅读回声首页：显示最近阅读、上次位置、上次速度和节奏记录。
- 节奏仪表盘：显示字/分、词/分范围估算，并在顶部显示剩余阅读时间。
- 六档视觉背景：每个速度档位都有独立色彩和背景图案；点击背景切换朦胧 / 清晰。
- 切档音效：朦胧背景使用合成器提示音；清晰背景使用本地切档音效，连续切档会按顺序播放。
- 本地隐私：阅读记录、偏好和回声只保存在本机。
- TTS 架构预留：新增 TextSegment、ReadingClock 和 Provider 接口文档，但不启用朗读功能。

## 安全提示

### macOS

本项目当前没有 Apple Developer ID 签名。如果提示“无法验证开发者”，请右键点击 `夜晚的书斋.app`，选择“打开”。

### Windows

如果 Windows SmartScreen 出现提示，可以选择“更多信息”后继续运行。正式签名版本会在后续考虑。

## 验证

发布前验证：

```sh
npm test
node --check app.mjs
node --check server.mjs
node --check sound-engine.mjs
node --check reading-clock.mjs
node --check text-segment.mjs
git diff --check
```

当前回归测试：45 项通过，0 项失败。
