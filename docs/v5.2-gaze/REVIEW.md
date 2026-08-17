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
