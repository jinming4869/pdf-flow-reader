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

function buildMultipart({ fileName, bytes, mimeType = "application/pdf" }) {
  const boundary = `----night-study-${Date.now().toString(36)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, Buffer.from(bytes), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
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

  async function createPdfItem({ title = "未命名 PDF", fileName = null } = {}) {
    const item = {
      itemType: "document",
      title: String(title).trim() || "未命名 PDF",
      contentType: "application/pdf",
      ...(fileName ? { filename: fileName } : {}),
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

  async function uploadPdf(itemKey, bytes, fileName) {
    if (!itemKey || !bytes?.byteLength) {
      throw new ZoteroWebError("上传需要条目 key 与 PDF 内容。", { code: "ZOTERO_WEB_UPLOAD_INVALID" });
    }
    const { body, contentType } = buildMultipart({
      fileName: String(fileName || "document.pdf"),
      bytes,
    });
    const result = await request(
      fetchFn,
      `${base}/items/${encodeURIComponent(itemKey)}/file`,
      {
        method: "POST",
        apiKey,
        timeoutMs,
        headers: {
          "Content-Type": contentType,
          "If-None-Match": "*",
        },
        body,
      },
    );
    return {
      uploaded: Boolean(result?.unchanged !== 0 || result?.uploaded !== 0 || result === null),
      raw: result,
    };
  }

  async function createChildNote(parentKey, html) {
    if (!parentKey || typeof html !== "string" || !html.trim()) {
      throw new ZoteroWebError("写 note 需要父条目 key 与内容。", { code: "ZOTERO_WEB_NOTE_INVALID" });
    }
    const note = {
      itemType: "note",
      parentItem: parentKey,
      note: String(html),
    };
    const result = await request(
      fetchFn,
      `${base}/items/${encodeURIComponent(parentKey)}/children`,
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
    uploadPdf,
    createChildNote,
  });
}
