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

## 2026-08-16：S2 复述客户端与延迟实测复核

结论：一句复述客户端、text-only 自动降级、待生成状态持久化完成；DeepSeek 真实 endpoint 延迟实测 P95 1010ms，远低于 3s 门限。

关键证据：

- Node 回归 405 / 405（echo-client 8 项、echo-state 5 项）；
- 真实延迟实测（deepseek-chat，20 次，合成句子）：全部成功，P50 822ms、P95 1010ms、min 517ms、max 1046ms；
- 401 错误路径实测：干净失败为 `EchoRequestError`（status 401），不抛未处理异常，不阻塞套索保存；
- 视觉能力按声明发送图文，4xx 自动降级 text-only 并记住能力；5xx 不降级；超时与外部取消分别识别；
- 输出契约：长度上限 400 字符，空输出拒绝；echo-state 的 done 终态与有界重试（最多 3 次）由单测锁定；
- 实测 key 仅经进程参数传入，未写入任何仓库文件；发送内容为合成句子，不含私人 PDF 数据。

视觉（图文）路径的真实延迟待支持视觉的 OpenAI-compatible 模型实测（当前 DeepSeek 只覆盖 text-only）。
