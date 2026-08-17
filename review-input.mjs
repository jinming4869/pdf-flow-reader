// review-input.mjs — 单书回望的输入构建（纯逻辑，可单测）
//
// 输入契约（冻结需求 §4）：航迹聚合 + 圈选文字集合 + 授权后的整书正文。
// 正文按页组织，分块只在页边界发生，每块保留页码锚点；
// 航迹聚合只输出统计与坐标序列，不输出私人原文。

export const REVIEW_DEFAULT_CHUNK_CHARS = 8_000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function splitBookTextIntoChunks(pages = [], {
  maxCharsPerChunk = REVIEW_DEFAULT_CHUNK_CHARS,
} = {}) {
  const valid = pages
    .map((page) => ({
      pageIndex: Math.max(0, Math.round(finiteNumber(page?.pageIndex))),
      text: typeof page?.text === "string" ? page.text : "",
    }))
    .filter((page) => page.text.trim())
    .sort((a, b) => a.pageIndex - b.pageIndex);

  const chunks = [];
  let buffer = [];
  let bufferChars = 0;

  const flush = (index) => {
    if (!buffer.length) return;
    chunks.push({
      index,
      pageStart: buffer[0].pageIndex,
      pageEnd: buffer.at(-1).pageIndex,
      charCount: bufferChars,
      text: buffer.map((page) => `[第 ${page.pageIndex + 1} 页]\n${page.text}`).join("\n\n"),
    });
    buffer = [];
    bufferChars = 0;
  };

  for (const page of valid) {
    const pageChars = page.text.length;
    if (buffer.length && bufferChars + pageChars > maxCharsPerChunk) {
      flush(chunks.length);
    }
    buffer.push(page);
    bufferChars += pageChars;
  }
  flush(chunks.length);
  return chunks;
}

export function buildTraceAggregate(traces = [], { maxCircledChars = 400 } = {}) {
  const valid = traces
    .filter((trace) => trace && typeof trace.id === "string" && trace.lifecycle !== "trashed")
    .sort((a, b) => (
      finiteNumber(a.readingContext?.readingOrder) - finiteNumber(b.readingContext?.readingOrder)
    ));

  const tierCounts = {};
  for (const trace of valid) {
    const tier = typeof trace.readingContext?.speedTier === "string"
      ? trace.readingContext.speedTier
      : "unknown";
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }

  const pageCounts = new Map();
  for (const trace of valid) {
    const page = Math.max(0, Math.round(finiteNumber(trace.pageIndex)));
    pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1);
  }
  const revisitedPages = [...pageCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([page, count]) => ({ page, count }));

  const emotionSequence = valid
    .filter((trace) => trace.emotion?.current)
    .map((trace) => ({
      page: Math.max(0, Math.round(finiteNumber(trace.pageIndex))),
      valence: Number(trace.emotion.current.valence).toFixed(2),
      arousal: Number(trace.emotion.current.arousal).toFixed(2),
    }));

  let circledText = valid
    .map((trace) => String(trace.source?.text ?? "").trim())
    .filter(Boolean)
    .join("\n");
  if (circledText.length > maxCircledChars) {
    circledText = `${circledText.slice(0, maxCircledChars)}…`;
  }

  const tierLines = Object.entries(tierCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tier, count]) => `${tier} × ${count}`)
    .join("；") || "无";

  const revisitedLines = revisitedPages.length
    ? revisitedPages.map((entry) => `第 ${entry.page + 1} 页（${entry.count} 条）`).join("、")
    : "无";

  return {
    traceCount: valid.length,
    tierDistribution: tierCounts,
    revisitedPages,
    emotionSequence,
    circledText,
    render() {
      const lines = [
        `# 阅读轨迹\n- 航迹数：${valid.length}`,
        `- 档位分布：${tierLines}`,
        `- 反复回到的位置：${revisitedLines}`,
        `- 情绪序列（页, 效价, 唤醒）：${emotionSequence.map((entry) => `第${entry.page + 1}页(${entry.valence},${entry.arousal})`).join(" → ") || "无"}`,
        `- 圈选文字摘录：${circledText || "无"}`,
      ];
      return lines.join("\n");
    },
  };
}

/**
 * 组装发给模型的完整输入（含分块正文）。返回值只包含将被发送的结构，
 * 由逐项授权清单决定是否真的发送。
 */
export function buildReviewInput(pages = [], traces = [], options = {}) {
  const chunks = splitBookTextIntoChunks(pages, options);
  const aggregate = buildTraceAggregate(traces, options);
  return {
    chunks,
    aggregate,
    totalChars: chunks.reduce((sum, chunk) => sum + chunk.charCount, 0),
    traceCount: aggregate.traceCount,
  };
}
