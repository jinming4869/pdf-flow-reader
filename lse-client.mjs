// lse-client.mjs — LSE 批判阅读工作纸生成客户端（v5.2）
//
// 输入：单书回望结果 + 圈选文字集合（可降级）。
// 输出：官方模板六字段的 JSON 契约，解析校验后返回。

export const LSE_DEFAULT_BASE_URL = "https://api.deepseek.com";
export const LSE_DEFAULT_MODEL = "deepseek-chat";
export const LSE_DEFAULT_TIMEOUT_MS = 90_000;

export const LSE_FIELDS = Object.freeze([
  "mainArgument",
  "evidence",
  "structure",
  "limitations",
  "literatureRelation",
  "openQuestions",
]);

export class LseRequestError extends Error {
  constructor(message = "LSE 工作纸生成失败。", { status = null, code = "LSE_REQUEST_FAILED" } = {}) {
    super(message);
    this.name = "LseRequestError";
    this.code = code;
    this.status = status;
  }
}

export class LseOutputInvalidError extends LseRequestError {
  constructor(message = "LSE 输出无效。") {
    super(message, { code: "LSE_OUTPUT_INVALID" });
  }
}

function parseWorksheet(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new LseOutputInvalidError();
  // 模型可能输出带 markdown 代码围栏的 JSON，先剥掉。
  const fenced = text.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  let parsed = null;
  try {
    parsed = JSON.parse(fenced);
  } catch {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LseOutputInvalidError();
    }
  }
  if (!parsed || typeof parsed !== "object") throw new LseOutputInvalidError();
  const worksheet = {};
  let anyField = false;
  for (const field of LSE_FIELDS) {
    const value = parsed[field];
    if (typeof value === "string" && value.trim()) {
      worksheet[field] = value.trim().slice(0, 2000);
      anyField = true;
    }
  }
  if (!anyField) throw new LseOutputInvalidError();
  return worksheet;
}

export function createLseClient({
  apiKey = "",
  baseUrl = LSE_DEFAULT_BASE_URL,
  model = LSE_DEFAULT_MODEL,
  timeoutMs = LSE_DEFAULT_TIMEOUT_MS,
  fetchFn = (...args) => fetch(...args),
  systemText = null,
} = {}) {
  if (!apiKey) throw new TypeError("createLseClient 需要 apiKey。");
  const endpoint = `${String(baseUrl).replace(/\/+$/u, "")}/chat/completions`;
  const prompt = typeof systemText === "string" && systemText
    ? systemText
    : null;

  async function generateWorksheet({
    reviewText = "",
    aggregateText = "",
    signal = null,
  } = {}) {
    const input = [aggregateText, reviewText].filter(Boolean).join("\n\n").trim();
    if (!input) throw new LseRequestError("没有可用于生成工作纸的回望内容。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const externalAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) throw signal.reason ?? new DOMException("已取消", "AbortError");
      signal.addEventListener("abort", externalAbort, { once: true });
    }
    try {
      const body = {
        model,
        messages: [
          { role: "system", content: prompt ?? "" },
          { role: "user", content: input },
        ],
      };
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new LseRequestError(`LSE 服务返回 ${response.status}。`, { status: response.status });
      }
      let parsed = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        throw new LseOutputInvalidError();
      }
      const worksheet = parseWorksheet(parsed?.choices?.[0]?.message?.content);
      return {
        worksheet,
        model,
        fields: Object.keys(worksheet),
      };
    } catch (error) {
      if (error instanceof LseRequestError) throw error;
      if (error?.name === "AbortError") {
        if (signal?.aborted) throw signal.reason ?? error;
        throw new LseRequestError("LSE 生成超时。", { code: "LSE_TIMEOUT" });
      }
      throw new LseRequestError(error?.message ?? "LSE 工作纸生成失败。");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", externalAbort);
    }
  }

  return Object.freeze({ generateWorksheet });
}
