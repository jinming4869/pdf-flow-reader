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
