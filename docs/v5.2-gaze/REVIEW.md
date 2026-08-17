# v5.2「回望」复核

## 2026-08-16：S1 逐项授权与 S2 Zotero 客户端复核

结论：授权模型与 Zotero 客户端链路完成；本机真实 Zotero 的 local API 实测可用。

### S1 逐项授权

- 三种范围：echo（配置即授权，沿用 v5.1）、review、lse（按书明确授权）；
- 授权状态按书持久化，范围之间不隐含升级，revoke 只移除目标；
- 发送内容清单函数只描述规模（字数、图片数、是否含正文），不嵌入内容；
- Node 回归 450 / 450（send-consent 7 项）。

### S2 Zotero 客户端

- zotero-local-client：仅回环地址；probe 兼容非 JSON 根响应；附件文件名优先 / 标题兜底匹配；
- zotero-web-client：key 校验、PDF 条目创建、multipart 上传（If-None-Match 防覆盖）、child note 写入；
- zotero-bridge：匹配 → 凭据 → 已匹配写 note / 未匹配创建 + 上传 + note；全程结构化安静失败；
- IPC 四通道 + preload；凭据槽位 `zotero-api-key` / `zotero-library-id`；
- 真实 Electron smoke：本机 Zotero local API 运行中，probe 成功；match 返回结构化结果；未配置凭据时 verify 安静返回 `ZOTERO_WEB_NO_CREDENTIALS`；
- Node 回归 450 / 450（local 7 项、web 7 项、bridge 5 项）。

### 待 S5 真实环境验收

- Web API 写入（需要产品所有者创建 zotero.org API key 与 library ID）；
- 未匹配时创建条目 + 上传 PDF；
- macOS 文件关联打包实测（Zotero 附件“打开方式”选中书斋）。

## 2026-08-16：S4 界面接入与 S5 打包复核

结论：回望 / LSE / Zotero 界面接入完成；5.2.0-beta.1 打包候选交付，等待产品所有者真实环境验收。

关键证据：

- Node 回归 466 / 466；
- Electron smoke 五套：integration（exit 0）、credential、archive、zotero、review-ui 全部 passed；
- review-ui smoke 实测：授权清单显示真实发送规模（整书 3583 字 + 航迹数），强分析未配置时安静禁用，本机 Zotero 探测“运行中”；
- packaged 未签名：凭据自检与归档自检 exit 0，三语言 TTS 与硬取消通过；
- packaged Info.plist 已注册 PDF 文件关联（CFBundleDocumentTypes）；
- ad-hoc 深签名 + strict verify 通过；
- 候选：`night-study-5.2.0-beta.1-mac-arm64.zip`，SHA-256 `383f2b5a984f7fd5fdf437e69de1c678623d4dade1d4b1af9e7f37c0ac2d403d`。

### S5 剩余：产品所有者真实环境验收

- 回望与 LSE：真实书（需要新的 echo-strong 凭据）；
- Zotero 双向：zotero.org API key + library ID，已匹配写 note / 未匹配创建条目 + 上传 PDF；
- Zotero → 书斋：Zotero 附件“打开方式”选中书斋并双击打开。

## 2026-08-16：回望与 LSE 真实生成实测

用产品所有者提供的 DeepSeek key 对合成书（3 页 + 2 条航迹）走真实生成：

- 回望：7.4 秒完成 1 块分节总结，页码锚点与两种立场概括准确；
- LSE：六字段全部返回，主张概括与输入一致；
- key 仅经进程参数传入，未写入任何仓库文件。

长书分块与真实书验收仍属产品所有者主观项。

## 2026-08-16：Zotero 真实环境实测

用产品所有者提供的 zotero.org API key（userID 19942372）实测：

- verifyKey：库读写 + 文件权限齐全；local API 运行中；
- 已匹配路径：真实文献《International Statebuilding...》经附件文件名精确匹配（ZQ3936ZW），child note 写入成功（PFRHWQTR）；
- 未匹配路径：条目创建 + 附件条目创建成功；文件上传因产品所有者网络环境无法解析 `files.zotero.net`（ENOTFOUND，nslookup 可解析但系统 resolver 失败）未能完成——属网络环境问题，错误已结构化展示；
- 修复两个协议错误：child note 走 POST /items 带 parentItem（/children 只读）；文件上传改为 Zotero 三步协议（授权 → 上传 → 注册）；
- 残留测试条目已全部清理，仅保留一条标注明确的测试 note（挂在 International Statebuilding 条目下，可在 Zotero 中删除）。

未匹配路径的上传完成条件：产品所有者网络可访问 `files.zotero.net`（检查代理 / DNS 规则）。
