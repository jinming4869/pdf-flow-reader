// zotero-bridge.mjs — 书斋 → Zotero 导入编排（主进程模块）
//
// 流程：local API 匹配 → 凭据校验 → 已匹配写 child note /
// 未匹配创建条目 + 上传 PDF + 写第一条 note。任何阶段失败都是
// 结构化结果，绝不抛出未处理异常，绝不阻塞本地功能。

import { ZoteroLocalError, createZoteroLocalClient } from "./zotero-local-client.mjs";
import { ZoteroWebError, createZoteroWebClient } from "./zotero-web-client.mjs";

export function publicBridgeError(error, stage = "zotero-bridge") {
  return {
    ok: false,
    stage,
    error: {
      code: typeof error?.code === "string" ? error.code : "ZOTERO_BRIDGE_FAILED",
      message: typeof error?.message === "string" ? error.message : "Zotero 操作失败。",
      status: error instanceof ZoteroWebError ? error.status : null,
    },
  };
}

function credentialValue(credentialStore, id) {
  return Promise.resolve()
    .then(() => credentialStore?.load?.(id))
    .then((value) => (typeof value === "string" && value ? value : null));
}

export function createZoteroBridge({
  credentialStore = null,
  localClient = null,
  webClientFactory = null,
  fetchFn = (...args) => fetch(...args),
} = {}) {
  if (!credentialStore) throw new TypeError("createZoteroBridge 需要 credentialStore。");
  const local = localClient ?? createZoteroLocalClient({ fetchFn });

  async function webClientFromCredentials() {
    const apiKey = await credentialValue(credentialStore, "zotero-api-key");
    const libraryId = await credentialValue(credentialStore, "zotero-library-id");
    if (!apiKey || !libraryId) {
      const error = new Error("Zotero Web API 凭据未配置。");
      error.code = "ZOTERO_WEB_NO_CREDENTIALS";
      throw error;
    }
    const factory = webClientFactory ?? ((options) => createZoteroWebClient({ fetchFn, ...options }));
    return factory({ apiKey, libraryId });
  }

  async function probe() {
    try {
      return { ok: true, ...(await local.probe()) };
    } catch (error) {
      return publicBridgeError(error, "local-probe");
    }
  }

  async function matchBook({ fileName = "", title = "" } = {}) {
    try {
      return { ok: true, ...(await local.matchBook({ fileName, title })) };
    } catch (error) {
      return publicBridgeError(error, "local-match");
    }
  }

  async function verifyCredentials() {
    try {
      const web = await webClientFromCredentials();
      return { ok: true, ...(await web.verifyKey()) };
    } catch (error) {
      return publicBridgeError(error, "web-verify");
    }
  }

  /**
   * @param {object} input
   * @param {string} input.fileName 当前书文件名（用于匹配）
   * @param {string} input.title 当前书标题（用于匹配与新建条目）
   * @param {Uint8Array} [input.pdfBytes] 未匹配时上传的 PDF 内容
   * @param {string} input.noteHtml 要写入的 child note HTML
   */
  async function pushBook({
    fileName = "",
    title = "",
    pdfBytes = null,
    noteHtml = "",
  } = {}) {
    const result = {
      ok: false,
      matched: null,
      matchKind: null,
      itemKey: null,
      noteKey: null,
      createdItem: false,
    };
    try {
      const match = await local.matchBook({ fileName, title });
      result.matched = match.matched;
      result.matchKind = match.matchKind;
      if (!noteHtml || !noteHtml.trim()) {
        const error = new Error("没有可写入的 note 内容。");
        error.code = "ZOTERO_NOTE_EMPTY";
        throw error;
      }
      const web = await webClientFromCredentials();
      if (match.matched) {
        result.itemKey = match.itemKey;
        const note = await web.createChildNote(match.itemKey, noteHtml);
        result.noteKey = note.noteKey;
      } else {
        const created = await web.createPdfItem({ title: title || fileName, fileName });
        result.itemKey = created.itemKey;
        result.createdItem = true;
        if (pdfBytes?.byteLength) {
          await web.uploadPdf(created.itemKey, pdfBytes, fileName || "document.pdf");
        }
        const note = await web.createChildNote(created.itemKey, noteHtml);
        result.noteKey = note.noteKey;
      }
      result.ok = true;
      return result;
    } catch (error) {
      const publicError = publicBridgeError(error, "push");
      return { ...result, ...publicError };
    }
  }

  return Object.freeze({
    probe,
    matchBook,
    verifyCredentials,
    pushBook,
  });
}
