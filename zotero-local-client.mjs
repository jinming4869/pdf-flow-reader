// zotero-local-client.mjs — Zotero local API 只读客户端与书籍匹配（主进程模块）
//
// 事实约束（2026-08-16 查证）：Zotero 7/8 的 local API 只读、无需认证；
// 仅接受回环地址，任何失败都是安静的结构化错误。

export const ZOTERO_LOCAL_BASE_URL = "http://127.0.0.1:23119";

export class ZoteroLocalError extends Error {
  constructor(message = "Zotero 本地服务不可用。", code = "ZOTERO_LOCAL_UNAVAILABLE") {
    super(message);
    this.name = "ZoteroLocalError";
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 4_000;

function normalizeTitle(value = "") {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/gu, " ");
}

function normalizeFileName(value = "") {
  const base = String(value ?? "").trim().toLowerCase();
  const stem = base.replace(/\.pdf$/u, "");
  return stem.replace(/\s+/gu, " ");
}

function safeBaseUrl(value) {
  const parsed = new URL(String(value));
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new ZoteroLocalError("Zotero 本地地址必须位于回环网络。", "ZOTERO_LOCAL_UNSAFE_URL");
  }
  return parsed.origin;
}

async function requestJson(fetchFn, url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ZoteroLocalError("Zotero 本地服务响应超时。", "ZOTERO_LOCAL_TIMEOUT")), timeoutMs);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    if (!response.ok) {
      throw new ZoteroLocalError(
        `Zotero 本地服务返回 ${response.status}。`,
        response.status === 404 ? "ZOTERO_LOCAL_NOT_FOUND" : "ZOTERO_LOCAL_ERROR",
      );
    }
    const raw = await response.text();
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      throw new ZoteroLocalError("Zotero 本地服务响应无法解析。", "ZOTERO_LOCAL_BAD_RESPONSE");
    }
  } catch (error) {
    if (error instanceof ZoteroLocalError) throw error;
    if (error?.name === "AbortError") {
      throw error.reason instanceof ZoteroLocalError
        ? error.reason
        : new ZoteroLocalError("Zotero 本地服务响应超时。", "ZOTERO_LOCAL_TIMEOUT");
    }
    throw new ZoteroLocalError(
      `无法连接 Zotero 本地服务：${error?.message ?? error}`,
      "ZOTERO_LOCAL_UNREACHABLE",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createZoteroLocalClient({
  baseUrl = ZOTERO_LOCAL_BASE_URL,
  fetchFn = (...args) => fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const origin = safeBaseUrl(baseUrl);

  async function probe() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(`${origin}/api/`, { signal: controller.signal });
      if (!response.ok) {
        throw new ZoteroLocalError(
          `Zotero 本地服务返回 ${response.status}。`,
          response.status === 404 ? "ZOTERO_LOCAL_NOT_FOUND" : "ZOTERO_LOCAL_ERROR",
        );
      }
      // /api/ 根路径可能返回纯文本版本信息，不要求 JSON。
      const raw = await response.text();
      let message = null;
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        message = typeof parsed?.message === "string" ? parsed.message : null;
      } catch {
        message = raw?.trim()?.slice(0, 120) || null;
      }
      return { available: true, message };
    } catch (error) {
      if (error instanceof ZoteroLocalError) throw error;
      if (error?.name === "AbortError") {
        throw new ZoteroLocalError("Zotero 本地服务响应超时。", "ZOTERO_LOCAL_TIMEOUT");
      }
      throw new ZoteroLocalError(
        `无法连接 Zotero 本地服务：${error?.message ?? error}`,
        "ZOTERO_LOCAL_UNREACHABLE",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function listTopItems({ limit = 100, q = null } = {}) {
    const query = new URLSearchParams({ format: "json", limit: String(Math.max(1, Math.min(100, Math.round(limit)))) });
    if (q) {
      query.set("q", String(q));
      query.set("qmode", "everything");
    }
    const items = await requestJson(fetchFn, `${origin}/api/users/0/items/top?${query}`, { timeoutMs });
    return Array.isArray(items) ? items : [];
  }

  async function childItems(itemKey) {
    if (typeof itemKey !== "string" || !itemKey) return [];
    const children = await requestJson(
      fetchFn,
      `${origin}/api/users/0/items/${encodeURIComponent(itemKey)}/children?format=json`,
      { timeoutMs },
    );
    return Array.isArray(children) ? children : [];
  }

  async function attachmentsFor(itemKey) {
    const children = await childItems(itemKey);
    return children
      .filter((child) => child?.data?.itemType === "attachment")
      .map((child) => ({
        key: child.key,
        fileName: child?.data?.filename ?? null,
        title: child?.data?.title ?? null,
      }));
  }

  /**
   * 把当前书匹配到 Zotero 条目：PDF 附件文件名校验优先，其次标题。
   */
  async function matchBook({ fileName = "", title = "", limit = 100 } = {}) {
    const wantedFileName = normalizeFileName(fileName);
    const wantedTitle = normalizeTitle(title);
    if (!wantedFileName && !wantedTitle) {
      throw new ZoteroLocalError("缺少可用于匹配的文件名或标题。", "ZOTERO_MATCH_NO_INPUT");
    }
    const items = await listTopItems({ limit });
    let titleCandidate = null;
    for (const item of items) {
      const itemTitle = normalizeTitle(item?.data?.title);
      if (wantedTitle && itemTitle === wantedTitle) {
        titleCandidate = { item, matchKind: "title" };
      }
      if (!wantedFileName) continue;
      try {
        const attachments = await attachmentsFor(item.key);
        const matched = attachments.find(
          (attachment) => attachment.fileName && normalizeFileName(attachment.fileName) === wantedFileName,
        );
        if (matched) {
          return {
            matched: true,
            matchKind: "attachment-filename",
            itemKey: item.key,
            title: item?.data?.title ?? null,
            attachmentKey: matched.key,
          };
        }
      } catch {
        // 单个条目附件读取失败不阻断整体匹配。
      }
    }
    if (titleCandidate) {
      return {
        matched: true,
        matchKind: "title",
        itemKey: titleCandidate.item.key,
        title: titleCandidate.item?.data?.title ?? null,
        attachmentKey: null,
      };
    }
    return { matched: false, matchKind: null, itemKey: null, title: null, attachmentKey: null };
  }

  return Object.freeze({
    probe,
    listTopItems,
    childItems,
    attachmentsFor,
    matchBook,
  });
}
