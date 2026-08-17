// zotero-web-client.mjs — zotero.org Web API 写入客户端（主进程模块）
//
// 只做三件事：校验 key、创建 PDF 条目并上传附件、写 child note。
// 不修改条目元数据，不删除任何内容。

export const ZOTERO_WEB_API_BASE = "https://api.zotero.org";

export class ZoteroWebError extends Error {
  constructor(message = "Zotero Web API 请求失败。", { status = null, code = "ZOTERO_WEB_FAILED" } = {}) {
    super(message);
    this.name = "ZoteroWebError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function request(fetchFn, url, {
  method = "GET",
  headers = {},
  body = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  apiKey = null,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const mergedHeaders = {
    ...(apiKey ? { "Zotero-API-Key": apiKey } : {}),
    ...headers,
  };
  try {
    const response = await fetchFn(url, {
      method,
      headers: mergedHeaders,
      body,
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // 非 JSON 响应按状态码处理。
    }
    if (!response.ok) {
      throw new ZoteroWebError(
        `Zotero Web API 返回 ${response.status}。`,
        { status: response.status, code: response.status === 403 ? "ZOTERO_WEB_FORBIDDEN" : "ZOTERO_WEB_FAILED" },
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof ZoteroWebError) throw error;
    if (error?.name === "AbortError") {
      throw new ZoteroWebError("Zotero Web API 响应超时。", { code: "ZOTERO_WEB_TIMEOUT" });
    }
    throw new ZoteroWebError(`无法连接 Zotero Web API：${error?.message ?? error}`, {
      code: "ZOTERO_WEB_UNREACHABLE",
    });
  } finally {
    clearTimeout(timer);
  }
}

export function createZoteroWebClient({
  apiKey = "",
  libraryId = "",
  fetchFn = (...args) => fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!apiKey) throw new TypeError("createZoteroWebClient 需要 apiKey。");
  if (!libraryId) throw new TypeError("createZoteroWebClient 需要 libraryId。");
  const base = `${ZOTERO_WEB_API_BASE}/users/${encodeURIComponent(libraryId)}`;

  async function verifyKey() {
    const info = await request(fetchFn, `${ZOTERO_WEB_API_BASE}/keys/current`, {
      apiKey,
      timeoutMs,
    });
    return {
      valid: Boolean(info?.userID),
      userID: info?.userID ?? null,
      access: {
        library: Boolean(info?.access?.user?.library),
        write: Boolean(info?.access?.user?.write),
        files: Boolean(info?.access?.user?.files),
      },
    };
  }

  async function createPdfItem({ title = "未命名 PDF" } = {}) {
    // contentType 只对 attachment 有效，document 条目不能携带。
    const item = {
      itemType: "document",
      title: String(title).trim() || "未命名 PDF",
    };
    const result = await request(fetchFn, `${base}/items`, {
      method: "POST",
      apiKey,
      timeoutMs,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([item]),
    });
    const entry = result?.successful?.["0"] ?? null;
    if (!entry?.key) {
      throw new ZoteroWebError("Zotero 条目创建失败。", { code: "ZOTERO_WEB_CREATE_FAILED" });
    }
    return { itemKey: entry.key, version: entry.version ?? null };
  }

  async function createAttachmentChild(parentKey, fileName) {
    if (!parentKey || typeof fileName !== "string" || !fileName) {
      throw new ZoteroWebError("附件创建需要父条目 key 与文件名。", { code: "ZOTERO_WEB_ATTACHMENT_INVALID" });
    }
    const attachment = {
      itemType: "attachment",
      parentItem: parentKey,
      linkMode: "imported_file",
      title: fileName,
      contentType: "application/pdf",
    };
    const result = await request(fetchFn, `${base}/items`, {
      method: "POST",
      apiKey,
      timeoutMs,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([attachment]),
    });
    const entry = result?.successful?.["0"] ?? null;
    if (!entry?.key) {
      throw new ZoteroWebError("Zotero 附件条目创建失败。", { code: "ZOTERO_WEB_ATTACHMENT_FAILED" });
    }
    return { attachmentKey: entry.key, version: entry.version ?? null };
  }

  async function uploadPdf(itemKey, bytes, fileName) {
    if (!itemKey || !bytes?.byteLength) {
      throw new ZoteroWebError("上传需要条目 key 与 PDF 内容。", { code: "ZOTERO_WEB_UPLOAD_INVALID" });
    }
    // Zotero 三步上传：授权 → 上传到返回地址 → 注册。
    const { createHash } = await import("node:crypto");
    const md5hex = createHash("md5").update(bytes).digest("hex");
    const mtime = Date.now();
    const name = String(fileName || "document.pdf");

    // 1) 上传授权。
    const authResponse = await fetchFn(`${base}/items/${encodeURIComponent(itemKey)}/file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "If-None-Match": "*",
        "Zotero-API-Key": apiKey,
      },
      body: [
        `md5=${encodeURIComponent(md5hex)}`,
        `filename=${encodeURIComponent(name)}`,
        `filesize=${bytes.length}`,
        `mtime=${mtime}`,
      ].join("&"),
    });
    if (!authResponse.ok) {
      throw new ZoteroWebError(`上传授权失败（${authResponse.status}）。`, {
        status: authResponse.status,
        code: "ZOTERO_WEB_UPLOAD_AUTH_FAILED",
      });
    }
    let auth = null;
    try {
      auth = JSON.parse(await authResponse.text());
    } catch {
      throw new ZoteroWebError("上传授权响应无法解析。", { code: "ZOTERO_WEB_UPLOAD_BAD_RESPONSE" });
    }
    if (auth?.exists) {
      return { uploaded: false, existed: true, md5: md5hex };
    }
    if (!auth?.uploadKey || typeof auth?.url !== "string") {
      throw new ZoteroWebError("上传授权缺少必要字段。", { code: "ZOTERO_WEB_UPLOAD_AUTH_FAILED" });
    }

    // 2) 上传文件内容（prefix + 内容 + suffix）。
    const uploadBody = Buffer.concat([
      Buffer.from(auth.prefix ?? "", "utf8"),
      Buffer.from(bytes),
      Buffer.from(auth.suffix ?? "", "utf8"),
    ]);
    const uploadResponse = await fetchFn(auth.url, {
      method: "POST",
      headers: { "Content-Type": auth.contentType ?? "application/pdf" },
      body: uploadBody,
    });
    if (![200, 201, 204].includes(uploadResponse.status)) {
      throw new ZoteroWebError(`文件上传失败（${uploadResponse.status}）。`, {
        status: uploadResponse.status,
        code: "ZOTERO_WEB_UPLOAD_FAILED",
      });
    }

    // 3) 注册上传。
    const registerResponse = await fetchFn(`${base}/items/${encodeURIComponent(itemKey)}/file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "If-None-Match": "*",
        "Zotero-API-Key": apiKey,
      },
      body: `upload=${encodeURIComponent(auth.uploadKey)}`,
    });
    if (![200, 204].includes(registerResponse.status)) {
      throw new ZoteroWebError(`上传注册失败（${registerResponse.status}）。`, {
        status: registerResponse.status,
        code: "ZOTERO_WEB_UPLOAD_REGISTER_FAILED",
      });
    }
    return { uploaded: true, md5: md5hex };
  }

  async function createChildNote(parentKey, html) {
    if (!parentKey || typeof html !== "string" || !html.trim()) {
      throw new ZoteroWebError("写 note 需要父条目 key 与内容。", { code: "ZOTERO_WEB_NOTE_INVALID" });
    }
    // /children 是只读端点；child note 通过 POST /items 带 parentItem 创建。
    const note = {
      itemType: "note",
      parentItem: parentKey,
      note: String(html),
    };
    const result = await request(
      fetchFn,
      `${base}/items`,
      {
        method: "POST",
        apiKey,
        timeoutMs,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([note]),
      },
    );
    const entry = result?.successful?.["0"] ?? null;
    if (!entry?.key) {
      throw new ZoteroWebError("Zotero note 创建失败。", { code: "ZOTERO_WEB_NOTE_FAILED" });
    }
    return { noteKey: entry.key, version: entry.version ?? null };
  }

  return Object.freeze({
    verifyKey,
    createPdfItem,
    createAttachmentChild,
    uploadPdf,
    createChildNote,
  });
}
