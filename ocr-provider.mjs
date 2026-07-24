const OCR_LANGUAGES = ["chi_sim", "chi_tra", "eng", "jpn"];
const PRIMARY_LANGUAGE_SET = "chi_sim+eng+jpn";
const TRADITIONAL_LANGUAGE_SET = "chi_tra+eng+jpn";
const OCR_TARGET_WIDTH = 1_420;
const OCR_MAX_SCALE = 2.2;
const TRADITIONAL_HINT = /[萬與專業東絲兩嚴個豐臨為麗舉麼義烏樂喬習鄉書買亂爭於雲亞產親億僅從儀們價眾優會傳傷倫體國語閱讀跡]/u;

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
  const scale = Math.min(
    OCR_MAX_SCALE,
    Math.max(1.35, OCR_TARGET_WIDTH / baseViewport.width),
  );
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
  let activeLanguageSet = PRIMARY_LANGUAGE_SET;

  async function ensureWorker(signal) {
    throwIfAborted(signal);
    if (!workerPromise) {
      const workerLifecycle = lifecycle;
      const pendingWorker = (async () => {
        const module = await import("./vendor/tesseract/tesseract.esm.min.js");
        const Tesseract = module.default;
        const createdWorker = await Tesseract.createWorker(
          PRIMARY_LANGUAGE_SET,
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

  async function recognizePage({ pdf, pageNumber, signal }) {
    const activeWorker = await ensureWorker(signal);
    const nativeText = await nativePageText(pdf, pageNumber, signal);
    const nativeHasText = nativeText.replace(/\s/gu, "").length >= 12;
    const preferredLanguageSet = nativeHasText
      ? TRADITIONAL_HINT.test(nativeText)
        ? TRADITIONAL_LANGUAGE_SET
        : PRIMARY_LANGUAGE_SET
      : activeLanguageSet;

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
      let result = await withAbort(activeWorker.recognize(canvas), signal);
      if (
        !nativeHasText &&
        activeLanguageSet === PRIMARY_LANGUAGE_SET &&
        TRADITIONAL_HINT.test(result.data.text)
      ) {
        await withAbort(
          activeWorker.reinitialize(TRADITIONAL_LANGUAGE_SET),
          signal,
        );
        activeLanguageSet = TRADITIONAL_LANGUAGE_SET;
        result = await withAbort(activeWorker.recognize(canvas), signal);
      }
      throwIfAborted(signal);
      return result.data.text;
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
    activeLanguageSet = PRIMARY_LANGUAGE_SET;
    if (activeWorker) await activeWorker.terminate();
  }

  return {
    languages: [...OCR_LANGUAGES],
    cancel: reset,
    recognizePage,
    reset,
  };
}
