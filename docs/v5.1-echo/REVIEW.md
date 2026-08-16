# v5.1「回声与归档」复核

## 2026-08-16：S1 系统凭据复核

结论：系统凭据 PoC 完成。凭据只进入 Electron safeStorage；不可用时 AI 静默禁用；旧 localStorage 明文字段迁移成功后删除；packaged 未签名与 ad-hoc 签名两种状态下读写实测通过。

关键证据：

- Node 回归 392 / 392（新增 credential-store 8 项、credential-ipc 5 项、扫描 2 项、preferences 注入 1 项）；
- 落盘密文不含明文（单测 + packaged 自检双重验证）；
- 损坏凭据文件隔离备份后重新开始；不可解密记录自动清除；
- IPC 只接受 127.0.0.1 renderer，错误信封不含凭据值，id 白名单校验；
- 开发 Electron smoke：status / save / load / remove / list 往返通过，UNTRUSTED_SENDER 保护生效；
- packaged 未签名目录包：`CREDENTIAL_SELF_CHECK passed`（available=true、roundTrip=true、onDiskLeak=false）；
- packaged ad-hoc 深签名 + strict verify 后：exit 0，结果同上；
- 迁移逻辑：localStorage 存在旧 key 时保存到 safeStorage 后清空字段；`sanitizeState` 删除空字段；
- 扫描测试：产品源码无硬编码密钥形状字符串；storage 默认值与清理断言固化。

打包白名单缺陷已修复：`credential-store.mjs` 与 `credential-ipc.mjs` 加入 electron-builder `files`，否则 packaged 主进程因模块缺失挂起。

残余风险：

- 浏览器调试环境（无 Electron 桥）仍可读旧字段，产品形态不受影响；
- renderer 持明文密钥于内存供 TTS 调用，未落日志；S2 实现 `TraceEchoProvider` 时评审是否改为主进程代发。
