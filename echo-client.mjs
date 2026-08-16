// echo-client.mjs — 图文一句复述的 OpenAI-compatible 客户端（v5.1）
//
// 输入契约（v5.0 已冻结）：套索裁图 + 圈选文字 + 有界附近上下文。
// 模型支持视觉时发送图文；不支持时自动降级纯文字并记录 text-only。
// 失败、断网、超时不阻塞套索保存或回流。

export const ECHO_DEFAULT_MODEL = "deepseek-chat";
export const ECHO_DEFAULT_BASE_URL = "https://api.deepseek.com";
export const ECHO_MAX_OUTPUT_CHARS = 400;
export const ECHO_DEFAULT_TIMEOUT_MS = 8_000;

export class EchoRequestError extends Error {
  constructor(message = "复述请求失败。", { status = null, code = "ECHO_REQUEST_FAILED" } = {}) {
    super(message);
    this.name = "EchoRequestError";
    this.code = code;
    this.status = status;
  }
}

export class EchoTimeoutError extends EchoRequestError {
  constructor(message = "复述请求超时。") {
    super(message, { code: "ECHO_TIMEOUT" });
  }
}

export class EchoOutputInvalidError extends EchoRequestError {
  constructor(message = "复述输出无效。") {
    super(message, { code: "ECHO_OUTPUT_INVALID" });
  }
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeOutput(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new EchoOutputInvalidError();
  const flattened = text.replace(/\s+/gu, " ");
  if (flattened.length > ECHO_MAX_OUTPUT_CHARS) {
    throw new EchoOutputInvalidError("复述输出超过长度限制。");
  }
  return flattened;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(index, index + chunkSize),
    );
  }
  return btoa(binary);
}

function buildVisionPayload({ systemText, userText, imageBytes, imageMimeType }) {
  return {
    model: null, // filled by caller
    messages: [
      { role: "system", content: systemText },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          {
            type: "image_url",
            image_url: {
              url: `data:${imageMimeType};base64,${bytesToBase64(imageBytes)}`,
            },
          },
        ],
      },
    ],
  };
}

function buildTextPayload({ systemText, userText }) {
  return {
    model: null,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userText },
    ],
  };
}

async function requestJson(fetchFn, url, { apiKey, body, timeoutMs, signal }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new EchoTimeoutError()), timeoutMs);
  const externalAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw signal.reason ?? new DOMException("已取消", "AbortError");
    }
    signal.addEventListener("abort", externalAbort, { once: true });
  }
  try {
    const response = await fetchFn(url, {
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
      // 非 JSON 响应按内容错误处理。
    }
    if (!response.ok) {
      const message = parsed?.error?.message ?? `复述服务返回 ${response.status}`;
      throw new EchoRequestError(message, { status: response.status });
    }
    const output = parsed?.choices?.[0]?.message?.content;
    return normalizeOutput(output);
  } catch (error) {
    if (error instanceof EchoRequestError) throw error;
    if (error?.name === "AbortError") {
      if (controller.signal.aborted && signal?.aborted) throw signal.reason ?? error;
      throw new EchoTimeoutError();
    }
    throw new EchoRequestError(error?.message ?? "复述请求失败。");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", externalAbort);
  }
}

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.baseUrl]
 * @param {string} [options.model]
 * @param {boolean} [options.vision] 预先声明的视觉能力；false 时直接文字路径。
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.fetchFn] 注入网络实现（单测用）。
 */
export function createEchoClient({
  apiKey = "",
  baseUrl = ECHO_DEFAULT_BASE_URL,
  model = ECHO_DEFAULT_MODEL,
  vision = false,
  timeoutMs = ECHO_DEFAULT_TIMEOUT_MS,
  fetchFn = (...args) => fetch(...args),
  systemText = "你是「夜晚的书斋」的朗读回响助手。用一句不超过六十字的话，复述读者圈选内容的核心意思。不要复读原文，不要给出评价或建议。",
} = {}) {
  if (!apiKey) throw new TypeError("createEchoClient 需要 apiKey。");
  const normalizedBase = String(baseUrl).replace(/\/+$/u, "");
  const endpoint = `${normalizedBase}/chat/completions`;
  let visionKnown = Boolean(vision);
  let visionSupported = Boolean(vision);

  function payloadFor({ text, imageBytes, imageMimeType }) {
    if (visionSupported && imageBytes?.byteLength) {
      return buildVisionPayload({ systemText, userText: text, imageBytes, imageMimeType });
    }
    return buildTextPayload({ systemText, userText: text });
  }

  return {
    get visionKnown() {
      return visionKnown;
    },
    get visionSupported() {
      return visionSupported;
    },

    /**
     * @param {object} input
     * @param {string} input.text 圈选文字 + 有界附近上下文
     * @param {Uint8Array} [input.imageBytes] 套索裁图（PNG）
     * @param {string} [input.imageMimeType]
     * @param {AbortSignal} [input.signal]
     * @returns {Promise<{ text, mode, model, latencyMs }>}
     */
    async generateEcho({
      text = "",
      imageBytes = null,
      imageMimeType = "image/png",
      signal = null,
    } = {}) {
      const userText = String(text ?? "").trim();
      if (!userText) throw new EchoRequestError("圈选文字为空，无法生成复述。");
      const startedAt = Date.now();
      const makeRequest = (payload) => requestJson(fetchFn, endpoint, {
        apiKey,
        body: { ...payload, model },
        timeoutMs,
        signal,
      });

      const canAttemptVision = Boolean(imageBytes?.byteLength) && visionSupported;

      let mode = "text-only";
      let resultText;
      if (canAttemptVision) {
        try {
          resultText = await makeRequest(payloadFor({
            text: userText,
            imageBytes,
            imageMimeType,
          }));
          mode = "vision";
          visionKnown = true;
          visionSupported = true;
        } catch (error) {
          if (
            visionSupported &&
            error instanceof EchoRequestError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            // 该模型不接受图文：记住能力并降级纯文字。
            visionKnown = true;
            visionSupported = false;
            resultText = await makeRequest(payloadFor({ text: userText }));
          } else {
            throw error;
          }
        }
      } else {
        resultText = await makeRequest(payloadFor({ text: userText }));
      }

      return {
        text: resultText,
        mode,
        model,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}
