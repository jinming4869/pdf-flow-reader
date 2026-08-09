# 阶段 10：macOS 本机 v5.0.0-beta.1 候选

状态：**自动化与打包通过；等待产品所有者真实 PDF 和主观体验验收**

日期：2026-08-09

基线：`c350762`（单书情绪航迹）

## 候选产物

```text
night-study-5.0.0-beta.1-mac-arm64.zip
SHA-256 9ad0dd7825846b9345808b25a2ed2407bd70694d2c90df6e9ac67960ae0f0de0
```

- ZIP：约 374MB；
- 解压后 `.app`：约 806MB；
- 架构：macOS arm64；
- Electron：43.2.0；
- Node runtime：24.18.0；
- 版本：5.0.0-beta.1；
- 签名：本机 ad-hoc，strict codesign verify 通过；
- 未使用 Developer ID，未公证，未发布 GitHub。

## 自动化证据

### 源码

- Node 完整回归：358 / 358；
- Electron integration smoke：书架、PDF、pointer、正式 preload、trace、crop、emotion、reflow、单书航迹、trash / restore 全部通过；
- 敏感路径与凭据扫描：通过；
- 测试与产品模块边界：通过。

### 目录包

- electron-builder macOS arm64 目录包：通过；
- afterPack 裁剪 79 个未使用英文 TTS 路径；
- 必需的 transformers.node、kokoro.js、af_heart 与 onnxruntime arm64 binding 均存在；
- 中、日、英 24kHz 单声道语音通过；
- CJK 硬取消和 worker 重建通过；
- bundle 复制到非 iCloud 路径后 ad-hoc deep sign 与 strict verify 通过；
- ZIP 完整性测试：通过。

### 真正 packaged main

以隔离 userData 和无版权旋转 PDF 启动 `.app` 主二进制：

```json
{
  "version": "5.0.0-beta.1",
  "canvasCount": 1,
  "traceLassoVisible": true,
  "traceBookVisible": true,
  "errorHidden": true
}
```

窗口在 smoke 模式中保持隐藏，普通启动默认不受该环境变量影响。

## 阶段 10 发现并修复的问题

1. **Worktree node_modules 符号链接导致打包漏依赖**
   改用当前 worktree 的真实 `npm ci`；afterPack 重新找到英文 TTS 依赖。

2. **Electron 下载卡住**
   使用本机同版本、同架构 Electron 43.2.0 dist，仍由 electron-builder 重新组装。

3. **iCloud FinderInfo 阻止 ad-hoc 签名**
   通过 `ditto --noextattr --norsrc` 将 bundle 物化到非 File Provider 路径后签名。

4. **`/tmp` 与 `/private/tmp` 使英文 worker 误判入口**
   `tts-worker.mjs` 改用 realpath 比较 argv 与 modulePath，并增加回归测试。修复前 worker code 0 退出，修复后三语言 smoke 全过。

## 依赖安全审计

`npm audit --omit=dev` 报告 3 个 high、0 critical：

```text
kokoro-js
└─ @huggingface/transformers
   └─ sharp < 0.35.0 / libvips advisory
```

当前没有可用自动修复。应用的本地 TTS 路径不把用户图片交给 sharp，但依赖仍被打包；这不是本机 beta 阻塞项，却必须在 GitHub 公开发布前评估、升级或进一步裁剪。

## 产品所有者仍需验收

自动化不能替代以下体验：

1. 普通文字 PDF；
2. 双栏论文；
3. 扫描书；
4. 旋转页；
5. 大型 PDF；
6. 30 秒回流是否自然；
7. 90 秒回流是否太慢；
8. 0.82 档内目标是否具有适度挑战；
9. 长时间使用后航迹图、截图和回收站是否符合直觉。

在这些验收完成前保持 beta 标识。

## 本机使用

1. 解压 ZIP；
2. 将 `.app` 放到本机合适位置；
3. 若 Gatekeeper 提示未识别开发者，右键应用并选择“打开”；
4. 选择 PDF；
5. 按 `L` 或点击“航迹”进入套索；
6. 落下情绪坐标，按“回到书流”；
7. 点击顶栏“航迹图”回看、修正或回到原页。

航迹事实保存在应用的本地 userData 中，不写回 PDF。

## 公开发布前

- 产品所有者真实样本与主观体验通过；
- Windows x64 构建与凭据边界；
- Developer ID、Windows 签名与公证评估；
- 依赖 high advisory 处置；
- 自动重开历史 PDF 路径；
- GitHub README、CHANGELOG、release workflow 和校验文件；
- 明确 beta → v5.0.0 的迁移策略。
