import * as pdfjsLib from "./vendor/pdf.mjs";
import { createLocalOcrProvider } from "./ocr-provider.mjs";
import { createFilePdfSource } from "./pdf-source.mjs";
import {
  captureReadingAnchor,
  createEstimatedPageLayout,
  findPageNumberAtOffset,
  pageTopsFromLayout,
  restoreReadingAnchor,
  updatePageLayout,
} from "./page-layout.mjs";
import {
  analyzeText,
  readingMetricMode,
  speedTier,
  unitsPerMinute,
} from "./reading-model.mjs";
import {
  cacheBudgetForDeviceMemory,
  RenderScheduler,
} from "./render-scheduler.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdf.worker.mjs",
  import.meta.url,
).href;

const elements = {
  viewport: document.querySelector("#viewport"),
  pages: document.querySelector("#pages"),
  loading: document.querySelector("#loading"),
  loadingText: document.querySelector("#loadingText"),
  emptyState: document.querySelector("#emptyState"),
  documentName: document.querySelector("#documentName"),
  fileButton: document.querySelector("#fileButton"),
  filePicker: document.querySelector("#filePicker"),
  controls: document.querySelector("#controls"),
  toggle: document.querySelector("#toggle"),
  toggleIcon: document.querySelector("#toggleIcon"),
  toggleText: document.querySelector("#toggleText"),
  speed: document.querySelector("#speed"),
  speedExperience: document.querySelector("#speedExperience"),
  speedValue: document.querySelector("#speedValue"),
  speedPixels: document.querySelector("#speedPixels"),
  speedEstimate: document.querySelector("#speedEstimate"),
  estimateWaiting: document.querySelector("#estimateWaiting"),
  cjkEstimate: document.querySelector("#cjkEstimate"),
  cjkRate: document.querySelector("#cjkRate"),
  estimateDivider: document.querySelector("#estimateDivider"),
  englishEstimate: document.querySelector("#englishEstimate"),
  englishRate: document.querySelector("#englishRate"),
  speedParticles: document.querySelector("#speedParticles"),
  pageStatus: document.querySelector("#pageStatus"),
  progressBar: document.querySelector("#progressBar"),
  finish: document.querySelector("#finish"),
  backToTop: document.querySelector("#backToTop"),
  ocrDock: document.querySelector("#ocrDock"),
  ocrButton: document.querySelector("#ocrButton"),
  ocrStatus: document.querySelector("#ocrStatus"),
  errorPanel: document.querySelector("#errorPanel"),
  errorText: document.querySelector("#errorText"),
};

const TEXT_WINDOW_RADIUS = 2;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const numberFormat = new Intl.NumberFormat("zh-CN");

let activePdf = null;
let activeLoadingTask = null;
let activeFileTransport = null;
let activeSourceKind = null;
let activeSourceLength = null;
let httpRangeDiagnostics = null;
let pendingSourceAbortController = null;
let loadGeneration = 0;
let pageShells = [];
let pageLayout = [];
let pageTops = [];
let pageGap = 24;
let pageCount = 0;
let renderScheduler = null;
let deviceMemoryGb = navigator.deviceMemory;
let scrollDirection = 1;
let lastScheduledDirection = 0;
let lastObservedScrollTop = 0;
let readyToMove = false;
let playing = true;
let wasPlayingBeforeHidden = false;
let speed = Number(elements.speed.value);
let easedSpeed = 0;
let scrollCarry = 0;
let lastFrame = 0;
let lastStatusUpdate = 0;
let activeReadingPage = 0;
let textWindowRequest = 0;
let lastEstimateSignature = "";
let pendingSpeedDelta = 0;
let particleTimer = 0;
let particleSequence = 0;
let firstPageMessageTimer = 0;
let resizeTimer = 0;
let pageTextCache = new Map();
let pageTextRequests = new Map();
let ocrTextCache = new Map();
let ocrProvider = null;
let ocrAbortController = null;
let ocrEnabled = false;
let ocrFailed = false;
let ocrScanRequest = 0;
let ocrRunChain = Promise.resolve();
let ocrProgressPosition = null;
let ocrScheduleTimer = 0;
let diagnosticsSession = {
  startedAt: performance.now(),
  metadataReadyMs: null,
  placeholderVisibleMs: null,
  firstHighQualityMs: null,
};

function emptyRenderSnapshot() {
  const budget = cacheBudgetForDeviceMemory(deviceMemoryGb, { ocrEnabled });
  return {
    timing: {
      elapsedMs: Math.round(performance.now() - diagnosticsSession.startedAt),
      firstRenderStartedMs: null,
      firstRenderCompletedMs: null,
    },
    render: { started: 0, completed: 0, cancelled: 0, failed: 0, evicted: 0 },
    canvas: { count: 0, pixels: 0, estimatedBytes: 0 },
    budget,
    hot: [],
    queue: [],
    running: [],
    currentPage: activeReadingPage,
    currentQuality: "placeholder",
  };
}

function collectDiagnosticsSnapshot() {
  const rendering = renderScheduler?.snapshot() ?? emptyRenderSnapshot();
  return {
    timing: {
      metadataReadyMs: diagnosticsSession.metadataReadyMs,
      placeholderVisibleMs: diagnosticsSession.placeholderVisibleMs,
      firstPreviewMs: null,
      firstHighQualityMs: diagnosticsSession.firstHighQualityMs,
      ...rendering.timing,
    },
    render: rendering.render,
    canvas: rendering.canvas,
    budget: rendering.budget,
    hot: rendering.hot,
    queue: rendering.queue,
    running: rendering.running,
    currentPage: rendering.currentPage,
    currentQuality: rendering.currentQuality,
    source: activeSourceKind
      ? {
          kind: activeSourceKind,
          length: activeSourceLength,
          ...(activeFileTransport?.diagnostics ?? httpRangeDiagnostics ?? {}),
        }
      : null,
    ocr: {
      enabled: ocrEnabled,
      running: Boolean(ocrAbortController),
      cachedPages: ocrTextCache.size,
      failed: ocrFailed,
    },
  };
}

function publishDiagnostics() {
  let output = document.querySelector("#performanceDiagnostics");
  if (!output) {
    output = document.createElement("output");
    output.id = "performanceDiagnostics";
    output.hidden = true;
    document.body.append(output);
  }
  output.textContent = JSON.stringify(collectDiagnosticsSnapshot());
}

window.__pdfFlowDiagnostics = Object.freeze({ snapshot: collectDiagnosticsSnapshot });

async function refreshHttpRangeDiagnostics(generation = loadGeneration) {
  if (activeSourceKind !== "http-range") return;
  try {
    const response = await fetch("./diagnostics.json", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    if (generation !== loadGeneration || activeSourceKind !== "http-range") return;
    httpRangeDiagnostics = result.httpRange ?? null;
    publishDiagnostics();
  } catch {
    // Diagnostics are best-effort and must never interrupt reading.
  }
}

function nearbyPageNumbers(centerPage) {
  if (!Number.isInteger(centerPage) || centerPage < 1 || centerPage > pageCount) {
    return [];
  }
  const pages = [centerPage];
  for (let distance = 1; distance <= TEXT_WINDOW_RADIUS; distance += 1) {
    if (centerPage - distance >= 1) pages.push(centerPage - distance);
    if (centerPage + distance <= pageCount) pages.push(centerPage + distance);
  }
  return pages;
}

function clearTextSession() {
  textWindowRequest += 1;
  activeReadingPage = 0;
  lastEstimateSignature = "";
  pageTextCache = new Map();
  pageTextRequests = new Map();
  ocrTextCache = new Map();
  ocrEnabled = false;
  ocrFailed = false;
  ocrScanRequest += 1;
  window.clearTimeout(ocrScheduleTimer);
  ocrScheduleTimer = 0;
  ocrAbortController?.abort();
  ocrAbortController = null;
  ocrProgressPosition = null;
  void ocrProvider?.reset?.();
  updateOcrControls();
}

function bestPageTextStats(pageNumber) {
  return (
    (ocrEnabled ? ocrTextCache.get(pageNumber) : null) ??
    pageTextCache.get(pageNumber) ??
    null
  );
}

async function extractPageTextStats(pageNumber, generation) {
  if (generation !== loadGeneration || !activePdf) return null;
  if (pageTextCache.has(pageNumber)) return pageTextCache.get(pageNumber);
  if (pageTextRequests.has(pageNumber)) return pageTextRequests.get(pageNumber);

  const request = activePdf
    .getPage(pageNumber)
    .then((page) => page.getTextContent())
    .then((content) => {
      if (generation !== loadGeneration) return null;
      const text = content.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      const stats = analyzeText(text);
      pageTextCache.set(pageNumber, stats);
      return stats;
    })
    .finally(() => {
      if (pageTextRequests.get(pageNumber) === request) {
        pageTextRequests.delete(pageNumber);
      }
    });

  pageTextRequests.set(pageNumber, request);
  return request;
}

function computeReadingEstimate() {
  if (!activeReadingPage) return null;

  let cjkCharacters = 0;
  let numericUnits = 0;
  let englishWords = 0;
  let measuredHeight = 0;

  for (const pageNumber of nearbyPageNumbers(activeReadingPage)) {
    const stats = bestPageTextStats(pageNumber);
    const shell = pageShells[pageNumber - 1];
    if (!stats || !shell) continue;
    cjkCharacters += stats.cjkCharacters;
    numericUnits += stats.numericUnits;
    englishWords += stats.englishWords;
    measuredHeight += shell.offsetHeight || Number(shell.dataset.height) || 0;
  }

  if (!measuredHeight) return null;

  const mode = readingMetricMode(cjkCharacters, englishWords);
  if (mode === "empty") return { mode, cjkRate: 0, englishRate: 0 };

  return {
    cjkRate: ["cjk", "both"].includes(mode)
      ? unitsPerMinute(cjkCharacters + numericUnits, measuredHeight, speed)
      : 0,
    englishRate: unitsPerMinute(englishWords, measuredHeight, speed),
    mode,
  };
}

function replayClass(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function renderSpeedEstimate(origin = "density") {
  const estimate = computeReadingEstimate();
  const signature = estimate
    ? `${estimate.mode}:${estimate.cjkRate}:${estimate.englishRate}`
    : "waiting";
  if (signature === lastEstimateSignature) return;
  lastEstimateSignature = signature;

  elements.estimateWaiting.hidden = Boolean(estimate);
  elements.cjkEstimate.hidden = !estimate || !["cjk", "both"].includes(estimate.mode);
  elements.englishEstimate.hidden =
    !estimate || !["english", "both"].includes(estimate.mode);
  elements.estimateDivider.hidden = !estimate || estimate.mode !== "both";

  if (!estimate) {
    elements.estimateWaiting.textContent = "正在轻轻估算…";
  } else if (estimate.mode === "empty") {
    elements.estimateWaiting.textContent = "这一带还没有可估算的文字";
    elements.estimateWaiting.hidden = false;
  } else {
    elements.cjkRate.textContent = numberFormat.format(estimate.cjkRate);
    elements.englishRate.textContent = numberFormat.format(estimate.englishRate);
  }

  if (origin === "density" && !reducedMotion.matches) {
    replayClass(elements.speedEstimate, "is-density-morph");
  }
}

function updateSpeedPresentation(origin = "initial") {
  const tier = speedTier(speed);
  elements.speedValue.textContent = tier.name;
  elements.speedPixels.textContent = String(speed);
  elements.speed.setAttribute(
    "aria-valuetext",
    `${speed} px/s，${tier.name}`,
  );
  elements.controls.dataset.theme = tier.themeKey;
  document.documentElement.dataset.readerTheme = tier.themeKey;
  renderSpeedEstimate(origin === "manual" ? "manual" : "density");
}

function animateManualSpeedChange(delta) {
  if (!delta || reducedMotion.matches) return;
  const className = delta > 0 ? "is-speeding-up" : "is-slowing-down";
  replayClass(elements.speedExperience, className);
  window.setTimeout(() => elements.speedExperience.classList.remove(className), 420);
}

function emitSpeedParticle() {
  const delta = pendingSpeedDelta;
  pendingSpeedDelta = 0;
  particleTimer = 0;
  if (!delta || reducedMotion.matches) return;

  const particle = document.createElement("span");
  particle.className = `speed-particle ${delta > 0 ? "is-plus" : "is-minus"}`;
  particle.dataset.path = String(particleSequence % 3);
  particleSequence += 1;
  particle.textContent = delta > 0 ? `+${delta}` : String(delta);
  elements.speedParticles.append(particle);
  particle.addEventListener("animationend", () => particle.remove(), { once: true });
  window.setTimeout(() => particle.remove(), 1_100);
}

function queueSpeedParticle(delta) {
  if (!delta || reducedMotion.matches) return;
  pendingSpeedDelta += delta;
  window.clearTimeout(particleTimer);
  particleTimer = window.setTimeout(emitSpeedParticle, 70);
}

async function refreshNearbyTextStats(centerPage, generation) {
  const request = ++textWindowRequest;
  for (const pageNumber of nearbyPageNumbers(centerPage)) {
    if (request !== textWindowRequest || generation !== loadGeneration) return;
    try {
      await extractPageTextStats(pageNumber, generation);
    } catch {
      if (generation === loadGeneration) {
        pageTextCache.set(pageNumber, analyzeText(""));
      }
    }
    if (
      request === textWindowRequest &&
      generation === loadGeneration &&
      activeReadingPage === centerPage
    ) {
      renderSpeedEstimate("density");
    }
  }
}

function handleReadingPageChange(pageNumber) {
  if (!pageNumber) return;
  const pageChanged = pageNumber !== activeReadingPage;
  if (pageChanged) {
    pageShells[activeReadingPage - 1]?.classList.remove("is-active");
    activeReadingPage = pageNumber;
    pageShells[activeReadingPage - 1]?.classList.add("is-active");
    lastEstimateSignature = "";
    renderSpeedEstimate("density");
    void refreshNearbyTextStats(pageNumber, loadGeneration);
    if (ocrEnabled) scheduleNearbyOcr(pageNumber);
  }

  if (pageChanged || lastScheduledDirection !== scrollDirection) {
    lastScheduledDirection = scrollDirection;
    renderScheduler?.updateView({
      currentPage: pageNumber,
      direction: scrollDirection,
      pageCount,
    });
    window.setTimeout(publishDiagnostics, 0);
    window.setTimeout(() => void refreshHttpRangeDiagnostics(), 240);
  }
}

function setPlaying(next) {
  playing = next;
  elements.toggleIcon.textContent = playing ? "Ⅱ" : "▶";
  elements.toggleText.textContent = playing ? "暂停" : "继续";
  elements.toggle.setAttribute("aria-pressed", String(!playing));
}

function clearFirstPageMessageTimer() {
  window.clearTimeout(firstPageMessageTimer);
  firstPageMessageTimer = 0;
}

function showError(error) {
  clearFirstPageMessageTimer();
  readyToMove = false;
  setPlaying(false);
  elements.toggle.disabled = true;
  elements.loading.hidden = true;
  elements.ocrDock.hidden = true;
  elements.errorText.textContent =
    error instanceof Error ? error.message : String(error);
  elements.errorPanel.hidden = false;
}

function showEmptyState() {
  clearFirstPageMessageTimer();
  clearTextSession();
  readyToMove = false;
  setPlaying(false);
  elements.emptyState.hidden = false;
  elements.loading.hidden = true;
  elements.controls.hidden = true;
  elements.ocrDock.hidden = true;
  elements.toggle.disabled = true;
  elements.documentName.textContent = "准备好开始阅读";
  elements.fileButton.textContent = "选择 PDF";
  elements.pageStatus.textContent = "请选择一份 PDF";
  elements.progressBar.style.width = "0%";
  document.title = "夜晚的书斋";
}

function targetPageWidth() {
  return Math.max(280, Math.min(940, elements.viewport.clientWidth - 44));
}

function showOpeningPageShell() {
  const width = targetPageWidth();
  const shell = document.createElement("section");
  shell.className = "page-shell opening-page is-active";
  shell.dataset.page = "1";
  shell.style.width = `${width}px`;
  shell.style.height = `${Math.round(width * Math.SQRT2)}px`;
  shell.setAttribute("aria-label", "第一页纸页底稿");
  elements.pages.replaceChildren(shell);
  diagnosticsSession.placeholderVisibleMs = Math.round(
    performance.now() - diagnosticsSession.startedAt,
  );
}

function refreshPageTops() {
  if (!pageShells.length || !pageLayout.length) {
    pageTops = [];
    return;
  }
  if (pageShells.length > 1) {
    pageGap = Math.max(
      0,
      pageShells[1].offsetTop - pageShells[0].offsetTop - pageLayout[0].height,
    );
  }
  pageTops = pageTopsFromLayout(pageLayout, {
    start: pageShells[0].offsetTop,
    gap: pageGap,
  });
}

function buildPageShells(pdf, firstViewport) {
  const width = targetPageWidth();
  const height = Math.round(width * (firstViewport.height / firstViewport.width));
  pageLayout = createEstimatedPageLayout({
    pageCount: pdf.numPages,
    width,
    height,
  });
  const shells = [];
  const fragment = document.createDocumentFragment();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const shell = document.createElement("section");
    shell.className = "page-shell";
    shell.dataset.page = String(pageNumber);
    shell.dataset.width = String(width);
    shell.dataset.height = String(height);
    shell.dataset.measured = String(pageNumber === 1);
    shell.style.width = `${width}px`;
    shell.style.height = `${height}px`;
    fragment.append(shell);
    shells.push(shell);
  }

  elements.pages.replaceChildren(fragment);
  pageShells = shells;
  refreshPageTops();
  return shells;
}

function correctPageShell(pageNumber, baseViewport) {
  const shell = pageShells[pageNumber - 1];
  const current = pageLayout[pageNumber - 1];
  if (!shell || !current) return;
  const width = Number(shell.dataset.width);
  const height = Math.round(width * (baseViewport.height / baseViewport.width));

  const anchorPage = currentPageNumber();
  const anchorIndex = Math.max(0, anchorPage - 1);
  const anchor = pageLayout[anchorIndex] && pageTops[anchorIndex] !== undefined
    ? captureReadingAnchor({
        pageNumber: anchorPage,
        pageTop: pageTops[anchorIndex],
        pageHeight: pageLayout[anchorIndex].height,
        scrollTop: elements.viewport.scrollTop,
        viewportHeight: elements.viewport.clientHeight,
      })
    : null;

  pageLayout = updatePageLayout(pageLayout, pageNumber, { width, height });
  shell.dataset.height = String(height);
  shell.dataset.measured = "true";
  if (current.height === height) return;

  shell.style.height = `${height}px`;
  refreshPageTops();
  if (anchor) {
    const nextIndex = anchor.pageNumber - 1;
    elements.viewport.scrollTop = restoreReadingAnchor(anchor, {
      pageTop: pageTops[nextIndex],
      pageHeight: pageLayout[nextIndex].height,
      viewportHeight: elements.viewport.clientHeight,
    });
  }
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
  canvas.remove();
}

function markPageRenderError(error, pageNumber) {
  const shell = pageShells[pageNumber - 1];
  if (!shell) return;
  shell.classList.remove("rendering", "rendered");
  shell.classList.add("render-error");
  shell.dataset.renderError = "这一页没有完成清晰显影，滚开再回来可以重试";
  shell.setAttribute("aria-label", `第 ${pageNumber} 页渲染失败`);
  if (pageNumber === activeReadingPage) {
    wasPlayingBeforeHidden = false;
    setPlaying(false);
  }
  console.warn(`第 ${pageNumber} 页渲染失败`, error);
}

function renderAbortError() {
  return new DOMException("页面渲染已取消", "AbortError");
}

async function prepareFinalPage(pdf, pageNumber, generation, { signal }) {
  if (signal.aborted || generation !== loadGeneration) throw renderAbortError();
  const shell = pageShells[pageNumber - 1];
  if (!shell) throw new Error(`找不到第 ${pageNumber} 页的底稿。`);
  shell.classList.remove("render-error");
  delete shell.dataset.renderError;
  shell.removeAttribute("aria-label");
  shell.classList.add("rendering");

  let page = null;
  let canvas = null;
  let renderTask = null;
  const cancelRender = () => renderTask?.cancel();
  signal.addEventListener("abort", cancelRender, { once: true });

  try {
    page = await pdf.getPage(pageNumber);
    if (signal.aborted || generation !== loadGeneration) throw renderAbortError();
    const baseViewport = page.getViewport({ scale: 1 });
    correctPageShell(pageNumber, baseViewport);

    const cssWidth = Number(shell.dataset.width);
    const cssScale = cssWidth / baseViewport.width;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
    canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法创建页面画布。");

    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    canvas.className = "page-canvas";
    canvas.setAttribute("aria-label", `第 ${pageNumber} 页`);
    renderTask = page.render({ canvasContext: context, viewport: renderViewport });
    await renderTask.promise;
    if (signal.aborted || generation !== loadGeneration) throw renderAbortError();

    let disposed = false;
    return {
      pixels: canvas.width * canvas.height,
      quality: `${pixelRatio}x`,
      commit() {
        if (disposed || generation !== loadGeneration) return;
        const previousCanvas = shell.querySelector("canvas");
        shell.replaceChildren(canvas);
        if (previousCanvas && previousCanvas !== canvas) releaseCanvas(previousCanvas);
        shell.classList.remove("rendering");
        shell.classList.add("rendered");
        if (reducedMotion.matches) canvas.classList.add("is-visible");
        else requestAnimationFrame(() => canvas.isConnected && canvas.classList.add("is-visible"));

        if (diagnosticsSession.firstHighQualityMs === null) {
          clearFirstPageMessageTimer();
          diagnosticsSession.firstHighQualityMs = Math.round(
            performance.now() - diagnosticsSession.startedAt,
          );
          elements.loading.hidden = true;
          elements.toggle.disabled = false;
          readyToMove = true;
          updateOcrControls();
        }
        publishDiagnostics();
        void refreshHttpRangeDiagnostics(generation);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        releaseCanvas(canvas);
        shell.classList.remove("rendered", "rendering");
        try {
          page.cleanup();
        } catch {
          // PDF.js may defer cleanup while OCR still owns a render task.
        }
      },
    };
  } catch (error) {
    releaseCanvas(canvas);
    shell.classList.remove("rendering");
    try {
      page?.cleanup();
    } catch {
      // A cancelled proxy may already be gone.
    }
    if (
      signal.aborted ||
      generation !== loadGeneration ||
      error?.name === "RenderingCancelledException"
    ) {
      throw renderAbortError();
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelRender);
  }
}

function updateRenderBudget() {
  renderScheduler?.setBudget(
    cacheBudgetForDeviceMemory(deviceMemoryGb, { ocrEnabled }),
  );
  publishDiagnostics();
}

async function disposeActiveDocument() {
  renderScheduler?.destroy();
  renderScheduler = null;
  activeFileTransport?.abort?.();
  activeFileTransport = null;
  activeSourceKind = null;
  activeSourceLength = null;
  httpRangeDiagnostics = null;

  const loadingTask = activeLoadingTask;
  const pdf = activePdf;
  activeLoadingTask = null;
  activePdf = null;
  try {
    if (loadingTask) await loadingTask.destroy();
    else if (pdf) await pdf.destroy();
  } catch {
    // A cancelled loading task may have already released its worker.
  }
}

async function openPdf(sourceOrFactory, displayName) {
  const generation = ++loadGeneration;
  pendingSourceAbortController?.abort();
  const sourceController = new AbortController();
  pendingSourceAbortController = sourceController;
  clearFirstPageMessageTimer();
  clearTextSession();
  diagnosticsSession = {
    startedAt: performance.now(),
    metadataReadyMs: null,
    placeholderVisibleMs: null,
    firstHighQualityMs: null,
  };
  readyToMove = false;
  easedSpeed = 0;
  scrollCarry = 0;
  pageCount = 0;
  pageShells = [];
  pageLayout = [];
  pageTops = [];
  elements.viewport.scrollTop = 0;
  scrollDirection = 1;
  lastScheduledDirection = 0;
  lastObservedScrollTop = 0;
  elements.pages.replaceChildren();
  elements.emptyState.hidden = true;
  elements.finish.hidden = true;
  elements.errorPanel.hidden = true;
  elements.loading.hidden = true;
  elements.loadingText.textContent = "正在显影第一页";
  elements.documentName.textContent = displayName;
  elements.pageStatus.textContent = "准备中";
  elements.progressBar.style.width = "0%";
  elements.controls.hidden = true;
  elements.ocrDock.hidden = true;
  elements.ocrStatus.hidden = true;
  elements.ocrStatus.textContent = "";
  elements.fileButton.textContent = "换一份 PDF";
  elements.toggle.disabled = true;
  elements.estimateWaiting.hidden = false;
  elements.estimateWaiting.textContent = "正在轻轻估算…";
  elements.cjkEstimate.hidden = true;
  elements.estimateDivider.hidden = true;
  elements.englishEstimate.hidden = true;
  elements.speedParticles.replaceChildren();
  window.clearTimeout(particleTimer);
  particleTimer = 0;
  pendingSpeedDelta = 0;
  setPlaying(true);
  showOpeningPageShell();
  firstPageMessageTimer = window.setTimeout(() => {
    if (
      generation === loadGeneration &&
      diagnosticsSession.firstHighQualityMs === null
    ) {
      elements.loading.hidden = false;
    }
  }, 850);

  // Defer even the first File.slice() until the request token and paper
  // placeholder exist. A later selection aborts this source before it can
  // replace the user's newest document.
  const sourcePromise = Promise.resolve().then(() => (
    typeof sourceOrFactory === "function"
      ? sourceOrFactory(sourceController.signal)
      : sourceOrFactory
  ));

  await disposeActiveDocument();
  let source;
  try {
    source = await sourcePromise;
  } catch (error) {
    if (pendingSourceAbortController === sourceController) {
      pendingSourceAbortController = null;
    }
    if (generation !== loadGeneration || sourceController.signal.aborted) return;
    throw error;
  }
  if (pendingSourceAbortController === sourceController) {
    pendingSourceAbortController = null;
  }
  if (generation !== loadGeneration || sourceController.signal.aborted) {
    source?.range?.abort?.();
    return;
  }
  activeFileTransport = source?.range?.abort ? source.range : null;
  activeSourceKind = activeFileTransport
    ? activeFileTransport.kind ?? "range"
    : source?.url
      ? "http-range"
      : "memory";
  activeSourceLength = Number.isSafeInteger(source?.length) ? source.length : null;
  publishDiagnostics();
  void refreshHttpRangeDiagnostics(generation);
  const task = pdfjsLib.getDocument(source);
  activeLoadingTask = task;
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    if (generation !== loadGeneration) return;
    throw error;
  }
  if (generation !== loadGeneration) {
    await task.destroy();
    return;
  }

  activePdf = pdf;
  pageCount = pdf.numPages;
  diagnosticsSession.metadataReadyMs = Math.round(
    performance.now() - diagnosticsSession.startedAt,
  );
  publishDiagnostics();
  void refreshHttpRangeDiagnostics(generation);
  document.title = `${displayName} · 夜晚的书斋`;
  let firstPage;
  try {
    firstPage = await pdf.getPage(1);
  } catch (error) {
    if (generation !== loadGeneration) return;
    throw error;
  }
  if (generation !== loadGeneration) return;
  const firstViewport = firstPage.getViewport({ scale: 1 });
  pageShells = buildPageShells(pdf, firstViewport);

  renderScheduler = new RenderScheduler({
    concurrency: 2,
    budget: cacheBudgetForDeviceMemory(deviceMemoryGb, { ocrEnabled }),
    render: (pageNumber, options) => prepareFinalPage(
      pdf,
      pageNumber,
      generation,
      options,
    ),
    onError: (error, pageNumber) => {
      if (generation !== loadGeneration) return;
      markPageRenderError(error, pageNumber);
      if (
        diagnosticsSession.firstHighQualityMs === null &&
        pageNumber === activeReadingPage
      ) showError(error);
    },
    onUpdate: publishDiagnostics,
  });
  elements.controls.hidden = false;
  elements.finish.hidden = false;
  updateReadingStatus(true);
}

function currentPageNumber() {
  if (!pageTops.length) return 0;
  const readingLine = elements.viewport.scrollTop + elements.viewport.clientHeight * 0.38;
  return findPageNumberAtOffset(pageTops, readingLine);
}

function resizeRenderedPages() {
  resizeTimer = 0;
  if (!activePdf || !pageShells.length || !pageLayout.length) return;

  const width = targetPageWidth();
  if (Math.abs(width - pageLayout[0].width) < 1) return;

  const anchorPage = currentPageNumber() || activeReadingPage || 1;
  const anchorIndex = anchorPage - 1;
  const anchor = captureReadingAnchor({
    pageNumber: anchorPage,
    pageTop: pageTops[anchorIndex],
    pageHeight: pageLayout[anchorIndex].height,
    scrollTop: elements.viewport.scrollTop,
    viewportHeight: elements.viewport.clientHeight,
  });

  renderScheduler?.reset();
  pageLayout = pageLayout.map((entry) => ({
    ...entry,
    width,
    height: Math.round(width * (entry.height / entry.width)),
  }));
  for (let index = 0; index < pageShells.length; index += 1) {
    const shell = pageShells[index];
    const entry = pageLayout[index];
    shell.dataset.width = String(entry.width);
    shell.dataset.height = String(entry.height);
    shell.style.width = `${entry.width}px`;
    shell.style.height = `${entry.height}px`;
  }
  refreshPageTops();
  elements.viewport.scrollTop = restoreReadingAnchor(anchor, {
    pageTop: pageTops[anchorIndex],
    pageHeight: pageLayout[anchorIndex].height,
    viewportHeight: elements.viewport.clientHeight,
  });
  lastScheduledDirection = 0;
  updateReadingStatus(true);
}

function updateReadingStatus(force = false, now = 0) {
  if (!force && now - lastStatusUpdate < 160) return;
  lastStatusUpdate = now;

  const maximum = Math.max(
    1,
    elements.viewport.scrollHeight - elements.viewport.clientHeight,
  );
  const progress = Math.min(100, (elements.viewport.scrollTop / maximum) * 100);
  elements.progressBar.style.width = `${progress}%`;

  const scrollDelta = elements.viewport.scrollTop - lastObservedScrollTop;
  if (Math.abs(scrollDelta) >= 1) scrollDirection = scrollDelta < 0 ? -1 : 1;
  lastObservedScrollTop = elements.viewport.scrollTop;

  const page = currentPageNumber();
  elements.pageStatus.textContent = page ? `${page} / ${pageCount} 页` : "准备中";
  handleReadingPageChange(page);
}

function animate(timestamp) {
  if (!lastFrame) lastFrame = timestamp;
  const elapsed = Math.min(64, timestamp - lastFrame);
  lastFrame = timestamp;

  const desiredSpeed = readyToMove && playing && !document.hidden ? speed : 0;
  const easing = 1 - Math.exp(-elapsed / 420);
  easedSpeed += (desiredSpeed - easedSpeed) * easing;

  if (Math.abs(easedSpeed) > 0.02) {
    scrollCarry += (easedSpeed * elapsed) / 1000;
    const wholePixels = Math.trunc(scrollCarry);
    if (wholePixels !== 0) {
      elements.viewport.scrollTop += wholePixels;
      scrollCarry -= wholePixels;
    }
  }

  const atEnd =
    readyToMove &&
    elements.viewport.scrollTop + elements.viewport.clientHeight >=
      elements.viewport.scrollHeight - 2;

  if (atEnd && playing) {
    setPlaying(false);
    easedSpeed = 0;
    scrollCarry = 0;
  }

  updateReadingStatus(false, timestamp);
  requestAnimationFrame(animate);
}

elements.toggle.addEventListener("click", () => {
  const atEnd =
    elements.viewport.scrollTop + elements.viewport.clientHeight >=
    elements.viewport.scrollHeight - 4;
  if (!playing && atEnd) elements.viewport.scrollTo({ top: 0, behavior: "smooth" });
  setPlaying(!playing);
});

elements.speed.addEventListener("input", () => {
  const previousSpeed = speed;
  speed = Number(elements.speed.value);
  const delta = speed - previousSpeed;
  updateSpeedPresentation("manual");
  animateManualSpeedChange(delta);
  queueSpeedParticle(delta);
});

function cacheOcrPageText(pageNumber, text, generation = loadGeneration) {
  if (
    generation !== loadGeneration ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > pageCount ||
    typeof text !== "string"
  ) {
    return false;
  }

  ocrTextCache.set(pageNumber, analyzeText(text, "ocr"));
  if (nearbyPageNumbers(activeReadingPage).includes(pageNumber)) {
    renderSpeedEstimate("density");
  }
  return true;
}

function registerOcrProvider(provider) {
  if (provider !== null && typeof provider?.recognizePage !== "function") {
    throw new TypeError("OCR provider 需要实现 recognizePage()。");
  }
  if (ocrProvider && ocrProvider !== provider) void ocrProvider.reset?.();
  ocrProvider = provider;
  updateOcrControls();
}

function updateOcrControls() {
  elements.ocrButton.disabled = !ocrProvider || !readyToMove;
  let buttonText = "扫描页增强估算";
  if (ocrEnabled) {
    buttonText = ocrFailed ? "重试扫描增强" : "关闭扫描增强";
  }
  elements.ocrButton.textContent = buttonText;
  elements.ocrButton.setAttribute("aria-pressed", String(ocrEnabled));
  elements.ocrDock.dataset.active = String(ocrEnabled);
  elements.ocrDock.hidden = !ocrProvider || !activePdf || !readyToMove;
}

function describeOcrProgress(message) {
  if (!ocrEnabled || !message) return;
  const percent = Number.isFinite(message.progress)
    ? `${Math.round(message.progress * 100)}%`
    : "";

  if (message.status === "recognizing text" && ocrProgressPosition) {
    const { index, total } = ocrProgressPosition;
    elements.ocrStatus.textContent = `正在扫描附近页 ${index}/${total}${percent ? ` · ${percent}` : ""}`;
    return;
  }

  if (
    message.status?.includes("loading") ||
    message.status?.includes("initializing")
  ) {
    elements.ocrStatus.hidden = false;
    elements.ocrStatus.textContent = `正在准备本地扫描模型${percent ? ` ${percent}` : ""}`;
  }
}

async function runNearbyOcr(centerPage, generation, request) {
  if (
    !ocrEnabled ||
    !ocrProvider ||
    !activePdf ||
    request !== ocrScanRequest ||
    generation !== loadGeneration
  ) {
    return;
  }

  const pages = nearbyPageNumbers(centerPage).filter(
    (pageNumber) => !ocrTextCache.has(pageNumber),
  );
  if (!pages.length) {
    elements.ocrStatus.hidden = false;
    elements.ocrStatus.textContent = "附近扫描已用于估算";
    return;
  }

  const controller = new AbortController();
  ocrAbortController = controller;
  elements.ocrStatus.hidden = false;

  try {
    for (let index = 0; index < pages.length; index += 1) {
      if (
        controller.signal.aborted ||
        !ocrEnabled ||
        request !== ocrScanRequest ||
        generation !== loadGeneration
      ) {
        break;
      }
      const pageNumber = pages[index];
      ocrProgressPosition = { index: index + 1, total: pages.length };
      elements.ocrStatus.textContent = `正在扫描附近页 ${index + 1}/${pages.length}`;
      const result = await ocrProvider.recognizePage({
        pdf: activePdf,
        pageNumber,
        signal: controller.signal,
      });
      const text = typeof result === "string" ? result : result?.text;
      cacheOcrPageText(pageNumber, text, generation);
    }
    if (
      !controller.signal.aborted &&
      ocrEnabled &&
      request === ocrScanRequest &&
      generation === loadGeneration
    ) {
      elements.ocrStatus.textContent = "附近扫描已用于估算";
    }
  } catch (error) {
    if (
      error?.name !== "AbortError" &&
      ocrEnabled &&
      request === ocrScanRequest &&
      generation === loadGeneration
    ) {
      ocrFailed = true;
      elements.ocrStatus.textContent = "扫描未完成，可以重试";
      updateOcrControls();
    }
  } finally {
    if (ocrAbortController === controller) {
      ocrAbortController = null;
    }
    ocrProgressPosition = null;
    publishDiagnostics();
  }
}

function scheduleNearbyOcr(centerPage = activeReadingPage) {
  if (!ocrEnabled || !ocrProvider || !activePdf || !centerPage) return;
  ocrFailed = false;
  updateOcrControls();
  const generation = loadGeneration;
  const request = ++ocrScanRequest;
  const hasActiveScan = Boolean(ocrAbortController);
  ocrAbortController?.abort();
  if (hasActiveScan) void ocrProvider.cancel?.();
  window.clearTimeout(ocrScheduleTimer);
  ocrScheduleTimer = window.setTimeout(() => {
    ocrScheduleTimer = 0;
    if (
      !ocrEnabled ||
      request !== ocrScanRequest ||
      generation !== loadGeneration
    ) {
      return;
    }
    ocrRunChain = ocrRunChain
      .catch(() => {})
      .then(() => runNearbyOcr(centerPage, generation, request));
  }, 180);
}

function disableOcr() {
  ocrEnabled = false;
  ocrFailed = false;
  ocrScanRequest += 1;
  window.clearTimeout(ocrScheduleTimer);
  ocrScheduleTimer = 0;
  ocrAbortController?.abort();
  ocrAbortController = null;
  ocrProgressPosition = null;
  void ocrProvider?.reset?.();
  elements.ocrStatus.hidden = true;
  lastEstimateSignature = "";
  renderSpeedEstimate("density");
  updateOcrControls();
  updateRenderBudget();
  publishDiagnostics();
}

function enableOcr() {
  if (!ocrProvider || !activePdf) return;
  ocrEnabled = true;
  ocrFailed = false;
  lastEstimateSignature = "";
  renderSpeedEstimate("density");
  updateOcrControls();
  updateRenderBudget();
  elements.ocrStatus.hidden = false;
  elements.ocrStatus.textContent = "正在准备本地扫描模型";
  scheduleNearbyOcr();
  publishDiagnostics();
}

window.pdfFlowReaderOcr = Object.freeze({
  registerProvider: registerOcrProvider,
  cachePageText: cacheOcrPageText,
  getContext: () => ({
    generation: loadGeneration,
    pageNumber: activeReadingPage,
    nearbyPages: nearbyPageNumbers(activeReadingPage),
    pdf: activePdf,
    enabled: ocrEnabled,
  }),
});

elements.ocrButton.addEventListener("click", () => {
  if (ocrEnabled && ocrFailed) scheduleNearbyOcr();
  else if (ocrEnabled) disableOcr();
  else enableOcr();
});

registerOcrProvider(
  createLocalOcrProvider({
    onProgress: describeOcrProgress,
  }),
);

async function openLocalFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    showError(new Error("请选择 PDF 文件。"));
    return;
  }

  try {
    await openPdf(
      (signal) => createFilePdfSource(file, {
        rangeChunkSize: 256 * 1024,
        signal,
      }),
      file.name,
    );
  } catch (error) {
    await disposeActiveDocument();
    showError(error);
  } finally {
    elements.filePicker.value = "";
  }
}

elements.filePicker.addEventListener("change", () => {
  void openLocalFile(elements.filePicker.files?.[0]);
});

document.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.preventDefault();
  document.body.classList.add("is-dragging");
});

document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) document.body.classList.remove("is-dragging");
});

document.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.preventDefault();
  document.body.classList.remove("is-dragging");
  void openLocalFile(event.dataTransfer?.files?.[0]);
});

elements.backToTop.addEventListener("click", () => {
  elements.viewport.scrollTo({ top: 0, behavior: "smooth" });
  setPlaying(true);
});

elements.viewport.addEventListener("scroll", () => updateReadingStatus(true), {
  passive: true,
});

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(resizeRenderedPages, 160);
});

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.target instanceof HTMLInputElement) return;
  event.preventDefault();
  elements.toggle.click();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    wasPlayingBeforeHidden = playing;
  } else if (wasPlayingBeforeHidden && readyToMove) {
    setPlaying(true);
  }
});

setInterval(() => {
  fetch("./heartbeat", { cache: "no-store" }).catch(() => {});
}, 30_000);

updateSpeedPresentation("initial");
requestAnimationFrame(animate);

try {
  const configResponse = await fetch("./config.json", { cache: "no-store" });
  if (!configResponse.ok) throw new Error("阅读器没有取得本地文件信息。");
  const config = await configResponse.json();
  deviceMemoryGb = config.systemMemoryGiB ?? navigator.deviceMemory;
  if (config.fileName) {
    await openPdf(
      {
        url: "./document.pdf",
        length: config.fileSize,
        rangeChunkSize: 256 * 1024,
        disableStream: true,
        disableAutoFetch: true,
      },
      config.fileName,
    );
  } else {
    showEmptyState();
  }
} catch (error) {
  await disposeActiveDocument();
  showError(error);
}
