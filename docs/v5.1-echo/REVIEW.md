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

## 2026-08-16：S3 归档适配器复核

结论：本地文件夹与 Obsidian 两种目的地的导出核心完成。幂等导出键（内容哈希进文件名）保证重复导出跳过、内容变化生成新文件、旧内容从不删除或改写；导出队列持久化且自动重试有界。

关键证据：

- Node 回归 417 / 417（archive-export 5 项、archive-repository 7 项）；
- 文件夹格式：标准 Markdown + 相对路径图片；Obsidian 格式：wiki-link；均含圈选文字、情绪坐标、档位、页码、一句复述（若有）与元数据；
- 幂等：相同内容重复导出 skipped（同名同路径），echo 补生成后重新导出产生新文件、旧文件保留；
- 队列：入队/出队/有界重试（最多 3 次）持久化，失败条目可手动重置；
- 目的地：每书单一目的地（type + path），清空后导出报 `ARCHIVE_NO_DESTINATION`；
- 文档目录名做文件系统字符清洗；
- Electron smoke：设置目的地 → 导出（md + png 落盘）→ 重复导出 skipped → 入队 → 状态快照 → 清空目的地，全部通过。

残余：Obsidian 真实 vault 写入与书架选择目录 UI（dialog）留待 S4/S5 产品形态验收。

## 2026-08-16：S4 Prompt 分层与界面复核

结论：内置只读版本化 Prompt、用户副本分层、回声／归档面板、复述自动生成链路与目录选择对话框完成。

关键证据：

- Node 回归 423 / 423（prompt-templates 6 项）；
- Prompt：内置 v1 只读；用户副本独立保存、升级不覆盖；解析结果带 source 与 stale 标记；存储不含密钥形状；
- 单书航迹面板新增“回声／归档”入口与“一句复述”详情区块（pending / done / failed 三态 + 手动重试）；
- 套索保存进入复核时异步生成复述（裁图缺失自动纯文字），不阻塞回流；
- 配置面板：baseURL / 模型 / 视觉开关存偏好，密钥只进 safeStorage（“echo-fast”槽位）；未配置时安静说明，离线核心不受影响；
- 归档面板：文件夹与 Obsidian 目录选择（dialog）、当前目的地、重新导出全部（新增/跳过计数）、清除目的地；
- Electron UI smoke：PDF 加载、入口点击、面板开关、未配置状态、配置保存、归档状态读取全部通过；
- 修复两处打包/服务缺陷：server 静态模块白名单补齐三个新 renderer 模块；echo-client 改用浏览器安全 base64（原 Buffer 在 renderer 不存在）。

S4 完成，v5.1 功能面闭环；进入 S5 打包与全量验收。
