const OCR_LANGUAGES = ["chi_sim", "chi_tra", "eng", "jpn"];
const DETECTION_LANGUAGE_SET = "chi_sim+eng+jpn";
const SIMPLIFIED_LANGUAGE_SET = "chi_sim+eng";
const TRADITIONAL_LANGUAGE_SET = "chi_tra+eng";
// Japanese study material often mixes kana with kanji vocabulary and Chinese
// explanations. Keep Japanese first so its punctuation and spacing model wins,
// while retaining simplified Chinese as a helper for mixed textbook pages.
const JAPANESE_LANGUAGE_SET = "jpn+chi_sim+eng";
const ENGLISH_LANGUAGE_SET = "eng";
const OCR_TARGET_WIDTH = 1_600;
const OCR_MAX_SCALE = 3.2;
const TRADITIONAL_HINT = /[萬與專業東絲兩嚴個豐臨為麗舉麼義烏樂喬習鄉書買亂爭於雲亞產親億僅從儀們價眾優會傳傷倫體國語閱讀跡]/u;

function scriptCount(text = "", pattern) {
  return [...String(text).matchAll(pattern)].length;
}

export function ocrLanguageSetForText(text = "", {
  fallback = DETECTION_LANGUAGE_SET,
} = {}) {
  const source = String(text);
  const kana = scriptCount(source, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = scriptCount(source, /\p{Script=Han}/gu);
  const latin = scriptCount(source, /\p{Script=Latin}/gu);
  if (kana >= 6 && kana >= Math.max(6, han * 0.04)) return JAPANESE_LANGUAGE_SET;
  if (TRADITIONAL_HINT.test(source)) return TRADITIONAL_LANGUAGE_SET;
  if (han >= 8) return SIMPLIFIED_LANGUAGE_SET;
  if (latin >= 24) return ENGLISH_LANGUAGE_SET;
  return fallback;
}

export function ocrLanguageSetForDocumentLabel(label = "") {
  const source = String(label);
  if (
    /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(source) ||
    /(?:日本語|日语|日語|japanese)/iu.test(source)
  ) {
    return JAPANESE_LANGUAGE_SET;
  }
  if (TRADITIONAL_HINT.test(source)) return TRADITIONAL_LANGUAGE_SET;
  const han = scriptCount(source, /\p{Script=Han}/gu);
  const latin = scriptCount(source, /\p{Script=Latin}/gu);
  if (han === 0 && latin >= 12) return ENGLISH_LANGUAGE_SET;
  return null;
}

export function ocrRenderScaleForWidth(width) {
  const pageWidth = Number(width);
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return 1.5;
  return Math.min(
    OCR_MAX_SCALE,
    Math.max(1.5, OCR_TARGET_WIDTH / pageWidth),
  );
}

function abortError() {
  return new DOMException("识别已取消", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(abortError());
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

async function renderPageForOcr(pdf, pageNumber, signal) {
  throwIfAborted(signal);
  const page = await pdf.getPage(pageNumber);
  throwIfAborted(signal);

  const baseViewport = page.getViewport({ scale: 1 });
  const scale = ocrRenderScaleForWidth(baseViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器无法准备 OCR 画布。");

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const renderTask = page.render({ canvasContext: context, viewport });
  const cancelRender = () => renderTask.cancel();
  signal?.addEventListener("abort", cancelRender, { once: true });

  try {
    await renderTask.promise;
  } catch (error) {
    if (signal?.aborted || error?.name === "RenderingCancelledException") {
      throw abortError();
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelRender);
  }

  throwIfAborted(signal);
  return canvas;
}

async function nativePageText(pdf, pageNumber, signal) {
  try {
    const page = await pdf.getPage(pageNumber);
    throwIfAborted(signal);
    const content = await page.getTextContent();
    throwIfAborted(signal);
    return content.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ");
  } catch (error) {
    if (signal?.aborted) throw abortError();
    return "";
  }
}

export function createLocalOcrProvider({ onProgress } = {}) {
  let worker = null;
  let workerPromise = null;
  let lifecycle = 0;
  let activeLanguageSet = DETECTION_LANGUAGE_SET;
  let documentLanguageSets = new WeakMap();

  async function ensureWorker(signal) {
    throwIfAborted(signal);
    if (!workerPromise) {
      const workerLifecycle = lifecycle;
      const pendingWorker = (async () => {
        const module = await import("./vendor/tesseract/tesseract.esm.min.js");
        const Tesseract = module.default;
        const createdWorker = await Tesseract.createWorker(
          DETECTION_LANGUAGE_SET,
          Tesseract.OEM.LSTM_ONLY,
          {
            workerPath: new URL(
              "./vendor/tesseract/worker.min.js",
              import.meta.url,
            ).href,
            corePath: new URL("./vendor/tesseract/core/", import.meta.url).href,
            langPath: new URL("./vendor/tesseract/lang/", import.meta.url).href,
            logger: (message) => {
              if (workerLifecycle === lifecycle) onProgress?.(message);
            },
          },
        );

        if (workerLifecycle !== lifecycle) {
          await createdWorker.terminate();
          throw abortError();
        }

        await createdWorker.setParameters({
          preserve_interword_spaces: "1",
          user_defined_dpi: "180",
        });
        worker = createdWorker;
        return createdWorker;
      })();
      const settledWorker = pendingWorker.catch((error) => {
        if (workerPromise === settledWorker) workerPromise = null;
        throw error;
      });
      workerPromise = settledWorker;
    }

    const activeWorker = await withAbort(workerPromise, signal);
    throwIfAborted(signal);
    return activeWorker;
  }

  async function recognizePage({ pdf, pageNumber, signal, documentLabel = "" }) {
    const activeWorker = await ensureWorker(signal);
    const nativeText = await nativePageText(pdf, pageNumber, signal);
    const nativeHasText = nativeText.replace(/\s/gu, "").length >= 12;
    const learnedLanguageSet = documentLanguageSets.get(pdf) ?? null;
    const labelLanguageSet = ocrLanguageSetForDocumentLabel(documentLabel);
    const preferredLanguageSet = labelLanguageSet ?? (nativeHasText
      ? ocrLanguageSetForText(nativeText, {
          fallback: learnedLanguageSet ?? DETECTION_LANGUAGE_SET,
        })
      : learnedLanguageSet ?? activeLanguageSet);

    if (preferredLanguageSet !== activeLanguageSet) {
      await withAbort(
        activeWorker.reinitialize(preferredLanguageSet),
        signal,
      );
      activeLanguageSet = preferredLanguageSet;
    }

    const canvas = await renderPageForOcr(pdf, pageNumber, signal);

    try {
      throwIfAborted(signal);
      let result = await withAbort(
        activeWorker.recognize(canvas, {}, { text: true, blocks: true }),
        signal,
      );
      const detectedLanguageSet = labelLanguageSet ?? ocrLanguageSetForText(
          nativeHasText ? nativeText : result.data.text,
          { fallback: activeLanguageSet },
        );
      if (detectedLanguageSet !== activeLanguageSet) {
        await withAbort(
          activeWorker.reinitialize(detectedLanguageSet),
          signal,
        );
        activeLanguageSet = detectedLanguageSet;
        result = await withAbort(
          activeWorker.recognize(canvas, {}, { text: true, blocks: true }),
          signal,
        );
      }
      documentLanguageSets.set(pdf, activeLanguageSet);
      throwIfAborted(signal);
      return {
        text: result.data.text,
        source: "ocr",
        pageNumber,
        languageSet: activeLanguageSet,
        pageDimensions: {
          width: canvas.width,
          height: canvas.height,
        },
        blocks: Array.isArray(result.data.blocks) ? result.data.blocks : [],
        words: Array.isArray(result.data.words) ? result.data.words : [],
        lines: Array.isArray(result.data.lines) ? result.data.lines : [],
      };
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  async function reset() {
    lifecycle += 1;
    const activeWorker = worker;
    worker = null;
    workerPromise = null;
    activeLanguageSet = DETECTION_LANGUAGE_SET;
    documentLanguageSets = new WeakMap();
    if (activeWorker) await activeWorker.terminate();
  }

  return {
    languages: [...OCR_LANGUAGES],
    cancel: reset,
    recognizePage,
    reset,
  };
}
