# 阶段 2：浏览器与 Electron 集成测试基础

状态：**本机通过**

日期：2026-08-09

基线：`23fba20`（已验收的 v4.1 书架）

## 目标

在实现任何航迹功能之前，建立一个不依赖私人 PDF、不降低 Electron 安全边界、能够重复验证 renderer 与桌面主进程连接的最小测试入口。

## 新增入口

```sh
npm run test:electron:smoke
```

可选保留本次运行截图：

```sh
ELECTRON_SMOKE_CAPTURE_DIR=/tmp/night-study-smoke npm run test:electron:smoke
```

截图、临时 PDF 与 Electron profile 均不进入仓库。

## 覆盖范围

1. 启动两个随机 loopback 端口：无文档书架和本机合成 PDF 阅读器。
2. 在隔离的临时 `userData` 中注入三本模拟阅读记录。
3. 验证书架卡片、新书入口、键盘 ArrowRight、选中标题和无横向溢出。
4. 派发真实 `PointerEvent`，证明后续可以测试套索手势。
5. 通过测试专用 preload 和 IPC handler 验证 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 下的隔离桥接。
6. 销毁并重建 BrowserWindow，验证 localStorage 在窗口重建后仍可恢复。
7. 生成一页无版权 PDF，验证页面 canvas、rendered shell、文档标题和隐藏错误面板。
8. 正常退出后清理临时 profile、PDF 和服务器。

## 生产隔离

- `scripts/electron-integration-smoke.cjs` 与 `scripts/electron-integration-preload.cjs` 仅供测试。
- 两个文件都不在 `package.json#build.files` 中，不进入正式桌面包。
- 测试 preload 只暴露一个固定 ping，不读取文件、不访问密钥。
- `node_modules` 工作树符号链接被 Git 忽略，不会进入提交。

## 测试证据

### 失败测试先行

`tests/electron-integration-contract.test.mjs` 最初因脚本与入口缺失产生 2 个预期失败；实现后 3 / 3 通过。

### 完整回归

- Node：297 / 297 通过；
- Electron smoke：通过；
- 书架：4 张卡片、ArrowRight 选中 Feynman Lectures、PointerEvent 坐标正确、选中卡片最终 opacity = 1；
- IPC：隔离 preload 返回 `isolated-preload`；
- 窗口重建：4 张卡片仍在；
- PDF：`1 / 1 页`、1 个 canvas、1 个 rendered shell、错误面板隐藏；
- `git diff --check`：通过；
- 测试脚本未进入生产包。

## 调试记录

第一次实际 smoke 在 session 清理阶段触发 SIGTRAP；移除不必要的运行中清理后消失。第二次在销毁最后窗口后重建失败；测试 runner 对齐正式 macOS 应用的 `window-all-closed` 生命周期，并改用独立临时 `userData` 后通过。没有通过关闭 sandbox、context isolation 或重启恢复检查来规避问题。

Chromium 在少数无头退出中可能输出一次非致命 SharedImage mailbox 日志；退出码、渲染结果与截图均正常，当前记录为测试环境噪声。

## 下一阶段

阶段 3 只建立航迹显式状态机、数据契约和 `app.mjs` 连接边界；不接入套索 UI、不写磁盘仓库。
