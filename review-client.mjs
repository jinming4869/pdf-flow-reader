// review-client.mjs — 单书回望的渐进生成客户端（v5.2）
//
// 逐块请求模型（每块一段分节总结），完成或取消后合并；
// 失败保留已完成部分；AbortSignal 贯穿全流程。

export const REVIEW_DEFAULT_BASE_URL = "https://api.deepseek.com";
export const REVIEW_DEFAULT_MODEL = "deepseek-chat";
export const REVIEW_DEFAULT_TIMEOUT_MS = 60_000;

export class ReviewRequestError extends Error {
  constructor(message = "回望请求失败。", { status = null, code = "REVIEW_REQUEST_FAILED", partial = null } = {}) {
    super(message);
    this.name = "ReviewRequestError";
    this.code = code;
    this.status = status;
    this.partial = partial;
  }
}

function normalizeChunkText(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new ReviewRequestError("模型返回了空的分节总结。");
  return text;
}

async function requestChunk(fetchFn, endpoint, { apiKey, model, systemText, chunk, timeoutMs, signal }) {
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
        { role: "system", content: systemText },
        { role: "user", content: chunk.text },
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
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // 非 JSON 响应按状态码处理。
    }
    if (!response.ok) {
      throw new ReviewRequestError(`回望服务返回 ${response.status}。`, { status: response.status });
    }
    return normalizeChunkText(parsed?.choices?.[0]?.message?.content);
  } catch (error) {
    if (error instanceof ReviewRequestError) throw error;
    if (error?.name === "AbortError") {
      if (signal?.aborted) throw signal.reason ?? error;
      throw new ReviewRequestError("回望请求超时。", { code: "REVIEW_TIMEOUT" });
    }
    throw new ReviewRequestError(error?.message ?? "回望请求失败。");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", externalAbort);
  }
}

export function createReviewClient({
  apiKey = "",
  baseUrl = REVIEW_DEFAULT_BASE_URL,
  model = REVIEW_DEFAULT_MODEL,
  timeoutMs = REVIEW_DEFAULT_TIMEOUT_MS,
  fetchFn = (...args) => fetch(...args),
  systemText = [
    "你是「夜晚的书斋」的单书回望助手。",
    "读者提供一本书的阅读轨迹聚合与按页分块的正文。",
    "为每个正文分块写一段 80 到 150 字的分节总结，保留页码锚点；",
    "最后给出不超过 300 字的整书总评。",
    "不要评价读者，不要虚构正文没有的内容。",
  ].join(""),
} = {}) {
  if (!apiKey) throw new TypeError("createReviewClient 需要 apiKey。");
  const endpoint = `${String(baseUrl).replace(/\/+$/u, "")}/chat/completions`;

  /**
   * @param {object} input
   * @param {Array<{index:number,pageStart:number,pageEnd:number,text:string}>} input.chunks
   * @param {string} input.aggregateText 航迹聚合文本（buildTraceAggregate().render()）
   * @param {AbortSignal} [input.signal]
   * @param {Function} [input.onProgress] ({ index, total, done, cancelled, error })
   */
  async function generateReview({
    chunks = [],
    aggregateText = "",
    signal = null,
    onProgress = () => {},
  } = {}) {
    const sections = [];
    let cancelled = false;
    let failedIndex = null;
    let errorCode = null;

    for (let index = 0; index < chunks.length; index += 1) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      const chunk = chunks[index];
      const chunkPrompt = index === 0
        ? `${aggregateText}\n\n# 正文分块\n${chunk.text}`
        : chunk.text;
      try {
        const text = await requestChunk(fetchFn, endpoint, {
          apiKey,
          model,
          systemText,
          chunk: { ...chunk, text: chunkPrompt },
          timeoutMs,
          signal,
        });
        sections.push({
          index: chunk.index,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          text,
        });
        onProgress({ index, total: chunks.length, done: index + 1, cancelled: false, error: null });
      } catch (error) {
        if (error?.name === "AbortError") {
          cancelled = true;
          break;
        }
        failedIndex = index;
        errorCode = error?.code ?? "REVIEW_REQUEST_FAILED";
        onProgress({ index, total: chunks.length, done: index, cancelled: false, error: errorCode });
        break;
      }
    }

    return {
      sections,
      cancelled,
      failedIndex,
      errorCode,
      partial: sections.length > 0 && (cancelled || failedIndex !== null),
    };
  }

  return Object.freeze({ generateReview });
}
