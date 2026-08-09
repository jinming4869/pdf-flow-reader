import { lassoBounds } from "./lasso-geometry.mjs";

function cropError(message, code = "TRACE_CROP_INVALID", ErrorType = TypeError) {
  const error = new ErrorType(message);
  error.code = code;
  return error;
}

function positiveDimension(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw cropError(`${name} 必须是正数。`);
  return Math.max(1, Math.round(number));
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function abortError() {
  return new DOMException("裁图已取消。", "AbortError");
}

function defaultCanvasFactory(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (globalThis.document?.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw cropError("当前环境无法创建离屏画布。", "TRACE_CROP_UNAVAILABLE");
}

async function canvasBlob(canvas, { mimeType, quality }) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(cropError("浏览器没有生成裁图 Blob。", "TRACE_CROP_ENCODING_FAILED"));
      }, mimeType, quality);
    });
  }
  throw cropError("画布不支持 Blob 编码。", "TRACE_CROP_UNAVAILABLE");
}

export function createLassoCropPlan({
  normalizedPath,
  sourceWidth,
  sourceHeight,
  padding = 24,
  maxPixels = 4_000_000,
} = {}) {
  const width = positiveDimension(sourceWidth, "sourceWidth");
  const height = positiveDimension(sourceHeight, "sourceHeight");
  const bounds = lassoBounds(normalizedPath);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw cropError("normalizedPath 不能形成可裁切区域。");
  }
  const context = Math.max(0, Math.round(Number(padding) || 0));
  const left = Math.max(0, Math.floor(bounds.x * width) - context);
  const top = Math.max(0, Math.floor(bounds.y * height) - context);
  const right = Math.min(width, Math.ceil((bounds.x + bounds.width) * width) + context);
  const bottom = Math.min(height, Math.ceil((bounds.y + bounds.height) * height) + context);
  const source = {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
  const pixelBudget = Number(maxPixels);
  if (!Number.isFinite(pixelBudget) || pixelBudget <= 0) {
    throw cropError("maxPixels 必须是正数。");
  }
  const sourcePixels = source.width * source.height;
  const scale = sourcePixels > pixelBudget
    ? Math.sqrt(pixelBudget / sourcePixels)
    : 1;
  const output = {
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale)),
    scale,
  };
  return {
    source,
    output,
    normalizedBounds: bounds,
    sourcePixels,
    outputPixels: output.width * output.height,
  };
}

export async function renderLassoCrop({
  sourceCanvas,
  normalizedPath,
  padding = 24,
  maxPixels = 4_000_000,
  mimeType = "image/png",
  quality,
  signal,
  canvasFactory = defaultCanvasFactory,
} = {}) {
  if (!sourceCanvas) throw cropError("sourceCanvas 缺失。");
  if (signal?.aborted) throw abortError();
  const plan = createLassoCropPlan({
    normalizedPath,
    sourceWidth: sourceCanvas.width,
    sourceHeight: sourceCanvas.height,
    padding,
    maxPixels,
  });
  const startedAt = now();
  const canvas = canvasFactory(plan.output.width, plan.output.height);
  canvas.width = plan.output.width;
  canvas.height = plan.output.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw cropError("无法创建裁图 2D context。", "TRACE_CROP_UNAVAILABLE");

  context.drawImage(
    sourceCanvas,
    plan.source.x,
    plan.source.y,
    plan.source.width,
    plan.source.height,
    0,
    0,
    plan.output.width,
    plan.output.height,
  );
  if (signal?.aborted) {
    canvas.width = 1;
    canvas.height = 1;
    throw abortError();
  }
  const blob = await canvasBlob(canvas, { mimeType, quality });
  const durationMs = Math.max(0, now() - startedAt);
  canvas.width = 1;
  canvas.height = 1;
  return {
    blob,
    width: plan.output.width,
    height: plan.output.height,
    mimeType: blob.type || mimeType,
    byteLength: blob.size,
    durationMs,
    plan,
  };
}
