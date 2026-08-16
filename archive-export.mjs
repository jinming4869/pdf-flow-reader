// archive-export.mjs — 读书痕迹的归档内容生成（纯逻辑，可单测）
//
// 导出单位：一条痕迹 → 一个 Markdown 文件 + 一张裁图 PNG。
// 幂等键：文件名含内容哈希，内容不变时同名；内容变化产生新文件，
// 旧目的地内容从不被删除或改写。

import { createHash } from "node:crypto";

export const ARCHIVE_DESTINATION_TYPES = Object.freeze(["folder", "obsidian"]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactTimestamp(iso = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso));
  if (!match) return "unknown";
  return `${match[1]}${match[2]}${match[3]}-${match[4]}${match[5]}`;
}

function emotionText(emotion) {
  const coordinate = emotion && typeof emotion === "object" ? emotion : null;
  if (!coordinate || !Number.isFinite(Number(coordinate.valence))) return "未放置";
  return `(${Number(coordinate.valence).toFixed(2)}, ${Number(coordinate.arousal).toFixed(2)})`;
}

function sentenceEscape(text = "") {
  return String(text).trim();
}

export function renderTraceMarkdown({
  trace = null,
  documentName = "未命名 PDF",
  echoText = "",
  imageName = "",
  format = "folder",
} = {}) {
  if (!trace || typeof trace !== "object") {
    throw new TypeError("renderTraceMarkdown 需要有效的 trace。");
  }
  const pageNumber = Math.max(1, Math.round(finiteNumber(trace.pageIndex)) + 1);
  const capturedAt = trace.readingContext?.capturedAt ?? trace.createdAt ?? "";
  const imageLink = format === "obsidian"
    ? `![[${imageName}]]`
    : `![](${imageName})`;
  const lines = [
    `# 读书痕迹 · ${sentenceEscape(documentName)} 第 ${pageNumber} 页`,
    "",
    `- 时间：${capturedAt}`,
    `- 情绪：${emotionText(trace.emotion?.original)} → ${emotionText(trace.emotion?.current)}`,
    `- 阅读档位：${trace.readingContext?.speedTier ?? ""} · ${finiteNumber(trace.readingContext?.speedPxPerSecond).toFixed(1)} px/s`,
    `- 阅读顺序：第 ${Math.max(1, Math.round(finiteNumber(trace.readingContext?.readingOrder)) + 1)} 条`,
    ...(echoText
      ? [`- 一句复述：${sentenceEscape(echoText)}`]
      : []),
    "",
    "## 圈选文字",
    "",
    `> ${sentenceEscape(trace.source?.text ?? "")}`,
  ];
  if (imageName) {
    lines.push(
      "",
      "## 裁图",
      "",
      imageLink,
    );
  }
  lines.push(
    "",
    "## 元数据",
    "",
    `- 痕迹 id：${trace.id}`,
    `- 文档指纹：${trace.documentFingerprint ?? ""}`,
    `- 文字来源：${trace.source?.provenance ?? "none"}`,
  );
  return `${lines.join("\n")}\n`;
}

export function archiveContentHash(trace = {}, echoText = "") {
  const payload = JSON.stringify({
    traceId: trace?.id ?? "",
    sourceText: trace?.source?.text ?? "",
    emotionOriginal: trace?.emotion?.original ?? null,
    emotionCurrent: trace?.emotion?.current ?? null,
    echoText: typeof echoText === "string" ? echoText : "",
    pageIndex: finiteNumber(trace?.pageIndex),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

/**
 * 幂等导出文件名：时间戳 + 痕迹 id + 内容哈希前 12 位。
 * 内容不变 → 文件名不变（重新导出跳过已存在文件）；
 * 内容变化 → 新文件名，旧文件保留。
 */
export function exportFileStemForTrace(trace = {}, echoText = "", now = new Date()) {
  const stamp = compactTimestamp(
    trace?.readingContext?.capturedAt ?? trace?.createdAt ?? now.toISOString(),
  );
  const traceId = String(trace?.id ?? "trace").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${stamp}-${traceId}-${archiveContentHash(trace, echoText)}`;
}

export function sanitizeDestinationType(type) {
  return ARCHIVE_DESTINATION_TYPES.includes(type) ? type : null;
}
