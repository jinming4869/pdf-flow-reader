import * as pdfjsLib from "./vendor/pdf.mjs";
import {
  bookSequenceLabel,
  carouselOffset,
  moveCarouselIndex,
  paletteForBook,
} from "./book-carousel.mjs";
import { createTraceBookController } from "./trace-book-controller.mjs";
import { createTraceCaptureController } from "./trace-capture-controller.mjs";
import { createTraceClient } from "./trace-client.mjs";
import { createLocalOcrProvider } from "./ocr-provider.mjs";
import {
  continuousOcrAheadPage,
  createOcrTaskScheduler,
} from "./ocr-schedule.mjs";
import {
  pointSegmentPreferenceForOcrLanguageSet,
  segmentsFromOcrResult,
} from "./ocr-segment-adapter.mjs";
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
  SPEED_TIERS,
  analyzeText,
  readingMetricMode,
  speedTier,
  unitsPerMinute,
} from "./reading-model.mjs";
import { createReadingClockSnapshot } from "./reading-clock.mjs";
import { createReflowController } from "./reflow-controller.mjs";
import { createRhythmSnapshot } from "./reading-rhythm.mjs";
import { segmentsToReadableChunks } from "./readable-chunk.mjs";
import { createSpeedCueEngine } from "./sound-engine.mjs";
import { segmentsFromPdfTextContent } from "./text-segment.mjs";
import {
  assessmentSupportsDensity,
  assessTextQuality,
  resolveTextSourceState,
  selectReadableChunks,
} from "./text-source-state.mjs";
import { createTtsAudioPlayer } from "./tts-audio-player.mjs";
import {
  canRequestManualSpeech,
  cancelTtsSession,
  createTtsController,
  runManualSpeechRequest,
} from "./tts-controller.mjs";
import {
  normalizeTtsPreferences,
  ttsProviderConfigFromPreferences,
  updateTtsPreferences,
} from "./tts-preferences.mjs";
import {
  shouldCancelPolicyTransition,
  shouldPreserveContinuousSpeechOnPageChange,
} from "./tts-policy.mjs";
import {
  createTtsWarmupRequest,
  pickTtsProvider,
} from "./tts-provider.mjs";
import { createTtsScheduler } from "./tts-scheduler.mjs";
import {
  advanceParagraphFlowContext,
  isLargeParagraphReadingJump,
  linkCrossPageParagraphs,
  materializeParagraphBoundaries,
  segmentsToParagraphPassages,
  shouldPreserveParagraphFlowOnPageChange,
} from "./tts-paragraph-flow.mjs";
import {
  pickReadableChunk,
  pickReadableSentenceBelowLine,
  previewPickedChunk,
} from "./tts-segment-picker.mjs";
import {
  shouldActivatePointReadGesture,
  shouldRenderPointReadHover,
} from "./tts-point-gesture.mjs";
import {
  createPointSentenceTargets,
  pickPointSentence,
} from "./tts-point-sentence.mjs";
import { createPointReadSession } from "./tts-point-session.mjs";
import {
  clearLocalState,
  createDocumentFingerprint,
  createDocumentId,
  latestRhythmEcho,
  readLocalState,
  recentDocumentRecords,
  upsertDocumentRecord,
  upsertRhythmRecord,
  writeLocalState,
} from "./storage.mjs";
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
  homeEcho: document.querySelector("#homeEcho"),
  recentBooks: document.querySelector("#recentBooks"),
  bookPrev: document.querySelector("#bookPrev"),
  bookNext: document.querySelector("#bookNext"),
  bookSelectionTitle: document.querySelector("#bookSelectionTitle"),
  bookSelectionMeta: document.querySelector("#bookSelectionMeta"),
  takeBook: document.querySelector("#takeBook"),
  openNewBook: document.querySelector("#openNewBook"),
  resumeHint: document.querySelector("#resumeHint"),
  rhythmEcho: document.querySelector("#rhythmEcho"),
  clearRecords: document.querySelector("#clearRecords"),
  documentName: document.querySelector("#documentName"),
  homeButton: document.querySelector("#homeButton"),
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
  rhythmInsight: document.querySelector("#rhythmInsight"),
  densityHint: document.querySelector("#densityHint"),
  traceLassoButton: document.querySelector("#traceLassoButton"),
  traceBookButton: document.querySelector("#traceBookButton"),
  traceStatus: document.querySelector("#traceStatus"),
  tracePanel: document.querySelector("#tracePanel"),
  tracePreview: document.querySelector("#tracePreview"),
  traceSummary: document.querySelector("#traceSummary"),
  emotionPad: document.querySelector("#emotionPad"),
  emotionMarker: document.querySelector("#emotionMarker"),
  emotionWords: document.querySelector("#emotionWords"),
  traceReturnButton: document.querySelector("#traceReturnButton"),
  bookTracePanel: document.querySelector("#bookTracePanel"),
  bookTraceClose: document.querySelector("#bookTraceClose"),
  bookTraceTitle: document.querySelector("#bookTraceTitle"),
  bookTraceChart: document.querySelector("#bookTraceChart"),
  bookTraceList: document.querySelector("#bookTraceList"),
  bookTraceImage: document.querySelector("#bookTraceImage"),
  bookTraceMeta: document.querySelector("#bookTraceMeta"),
  bookTraceJump: document.querySelector("#bookTraceJump"),
  bookTraceTrash: document.querySelector("#bookTraceTrash"),
  bookTraceTrashView: document.querySelector("#bookTraceTrashView"),
  bookEmotionPad: document.querySelector("#bookEmotionPad"),
  bookEmotionMarker: document.querySelector("#bookEmotionMarker"),
  bookEmotionWords: document.querySelector("#bookEmotionWords"),
  ttsPointReadButton: document.querySelector("#ttsPointReadButton"),
  ttsPointReadStatus: document.querySelector("#ttsPointReadStatus"),
  topReadingTime: document.querySelector("#topReadingTime"),
  speedParticles: document.querySelector("#speedParticles"),
  ttsControls: document.querySelector(".tts-controls"),
  ttsModeButton: document.querySelector("#ttsModeButton"),
  ttsManualReadButton: document.querySelector("#ttsManualReadButton"),
  ttsStatus: document.querySelector("#ttsStatus"),
  pageStatus: document.querySelector("#pageStatus"),
  progressBar: document.querySelector("#progressBar"),
  finish: document.querySelector("#finish"),
  backToTop: document.querySelector("#backToTop"),
  ocrDock: document.querySelector("#ocrDock"),
  ocrButton: document.querySelector("#ocrButton"),
  ocrStatus: document.querySelector("#ocrStatus"),
  ttsDiagnosticsPanel: document.querySelector("#ttsDiagnosticsPanel"),
  ttsDiagnosticsOutput: document.querySelector("#ttsDiagnosticsOutput"),
  ttsDiagnosticsClose: document.querySelector("#ttsDiagnosticsClose"),
  ttsDiagnosticsSelfTest: document.querySelector("#ttsDiagnosticsSelfTest"),
  errorPanel: document.querySelector("#errorPanel"),
  errorText: document.querySelector("#errorText"),
};

const TEXT_WINDOW_RADIUS = 2;
const RESTORE_TOAST_MS = 4_200;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const numberFormat = new Intl.NumberFormat("zh-CN");

let localState = readLocalState();
localState = updateTtsPreferences(localState, normalizeTtsPreferences(localState.preferences));
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
let speed = localState.preferences.defaultSpeedPxPerSecond;
elements.speed.value = String(speed);
let lastFlowSpeed = speed;
let pausedAt = Date.now();
let hiddenAt = null;
const readingReflow = createReflowController();
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
let pageReadableChunkCache = new Map();
let pageParagraphPassageCache = new Map();
let pagePointSentenceCache = new Map();
let ocrTextCache = new Map();
let ocrReadableChunkCache = new Map();
let ocrParagraphPassageCache = new Map();
let ocrPointSentenceCache = new Map();
let paragraphPassageRevisions = new Map();
let paragraphFlowContextState = null;
let ttsParagraphJumpPending = false;
let nativeTextAssessments = new Map();
let ocrTextAssessments = new Map();
let pageTextSourceStates = new Map();
let ocrTaskByPage = new Map();
let ocrFailureByPage = new Map();
let ocrProvider = null;
let ocrAbortController = null;
let ocrWorkloadActive = false;
let ocrLastError = null;
let ocrScanRequest = 0;
let ocrRunChain = Promise.resolve();
let ocrProgressPosition = null;
let diagnosticsSession = {
  startedAt: performance.now(),
  metadataReadyMs: null,
  placeholderVisibleMs: null,
  firstHighQualityMs: null,
};
let activeDocumentRecord = null;
let activeFileMeta = null;
let activeTraceDocument = null;
let pendingResumeRecord = null;
let homeBookItems = [];
let homeBookIndex = 0;
let homeBookSelectedId = null;
let homeBookTakeTimer = 0;
let homeBookWheelLocked = false;
let returningHome = false;
let persistTimer = 0;
let restoreMessageTimer = 0;
let activeCredentialApiKey = null;
let credentialBridgeState = { available: false, reason: "uninitialized" };

function createSwitchableTtsProvider(initialConfig) {
  let current = pickTtsProvider(initialConfig);
  return {
    setConfig(nextConfig) {
      current = pickTtsProvider(nextConfig);
    },
    synthesize(args) {
      return current.synthesize(args);
    },
    cancel() {
      return current.cancel?.();
    },
    get id() {
      return current.id;
    },
    get name() {
      return current.name;
    },
    get mode() {
      return current.mode;
    },
  };
}

function refreshTtsProviderFromCredentials() {
  switchableTtsProvider.setConfig(ttsProviderConfigFromPreferences(
    localState.preferences,
    { credentialApiKey: activeCredentialApiKey },
  ));
}

async function initializeCredentialBridge() {
  const bridge = window.nightStudyCredential;
  if (!bridge?.status) {
    credentialBridgeState = { available: false, reason: "no-bridge" };
    refreshTtsProviderFromCredentials();
    return;
  }
  try {
    const status = await bridge.status();
    if (!status?.ok || !status.available) {
      credentialBridgeState = {
        available: false,
        reason: status?.error?.reason ?? "safe-storage-unavailable",
      };
      refreshTtsProviderFromCredentials();
      return;
    }
    credentialBridgeState = { available: true, reason: null };
    const legacy = typeof localState.preferences.openaiTtsApiKey === "string"
      ? localState.preferences.openaiTtsApiKey
      : "";
    if (legacy) {
      const saved = await bridge.save("openai-tts", legacy);
      if (saved?.ok) {
        localState = writeLocalState({
          ...localState,
          preferences: {
            ...localState.preferences,
            openaiTtsApiKey: "",
          },
        });
      }
    }
    const loaded = await bridge.load("openai-tts");
    if (loaded?.ok && typeof loaded.secret === "string" && loaded.secret) {
      activeCredentialApiKey = loaded.secret;
    }
  } catch {
    credentialBridgeState = { available: false, reason: "bridge-error" };
  }
  refreshTtsProviderFromCredentials();
}

const switchableTtsProvider = createSwitchableTtsProvider(
  ttsProviderConfigFromPreferences(localState.preferences),
);
let ttsWarmupPromise = null;
let ttsWarmupStatus = "idle";
let ttsWarmupActiveKey = null;
const ttsWarmupReadyKeys = new Set();
let ttsUtteranceLocked = false;
let ttsRuntimeActivationPromise = null;
let activeTtsTierKey = speedTier(speed).themeKey;
const pointReadSession = createPointReadSession();
let pointReadScrollHold = false;
let pointReadGesture = null;
const traceClient = createTraceClient();

const speedCueEngine = createSpeedCueEngine({
  getVolume: () => localState.preferences.soundCueVolume,
  getPatternMode: () => localState.preferences.rhythmPatternMode,
  getSampleUrl: (step) => `./build/sound-cues/${step.direction}-${step.boundaryIndex + 1}.m4a`,
});
const ttsAudioPlayer = createTtsAudioPlayer({
  volume: localState.preferences.ttsVolume,
  muted: localState.preferences.ttsMuted,
  onStateChange: (state) => {
    if (state?.ended) {
      ttsUtteranceLocked = false;
      ttsScheduler.releasePlaybackLock("playback-ended");
      settlePointReadPlayback("ended");
      if (playing) updateTtsSchedulerDiagnostics(activeReadingPage || currentPageNumber());
    }
    publishDiagnostics();
  },
});
const ttsScheduler = createTtsScheduler({
  provider: switchableTtsProvider,
  onPick: ({ pick }) => {
    ttsUtteranceLocked = true;
    if (pick?.chunk?.pointReadRequestId) {
      pointReadSession.markPhase(pick.chunk.pointReadRequestId, "synthesizing");
      renderPointReadHighlight(pick.chunk, { phase: "queued" });
    } else {
      renderTtsFocus(pick, { phase: "queued" });
    }
    refreshTtsRuntimeStatus();
  },
  onResult: ({ result, pick }) => {
    const pointToken = pick?.chunk?.pointReadRequestId ?? null;
    if (pointToken) {
      pointReadSession.markPhase(pointToken, "playing");
      renderPointReadHighlight(pick.chunk, { phase: "speaking" });
    } else {
      renderTtsFocus(pick, { phase: "speaking" });
    }
    void ttsAudioPlayer.play(result)
      .then((source) => {
        if (!source) {
          ttsUtteranceLocked = false;
          ttsScheduler.releasePlaybackLock("playback-skipped");
          if (pointToken) settlePointReadPlayback("failed", pointToken);
        }
      })
      .catch(() => {
        ttsUtteranceLocked = false;
        ttsScheduler.releasePlaybackLock("playback-failed");
        if (pointToken) settlePointReadPlayback("failed", pointToken);
      })
      .finally(() => {
        refreshTtsRuntimeStatus();
        publishDiagnostics();
      });
  },
});
const ttsController = createTtsController({
  scheduler: ttsScheduler,
  getSpeedTier: () => speedTier(speed).themeKey,
  onStateChange: updateTtsUi,
});
ttsController.setEnabled(localState.preferences.ttsEnabled);

const ocrTaskScheduler = createOcrTaskScheduler({
  delayMs: 180,
  setTimeoutFn: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeoutFn: (timerId) => window.clearTimeout(timerId),
  onReady: ({ centerPage, priorityPage, generation, request }) => {
    if (
      !ocrWorkloadActive ||
      request !== ocrScanRequest ||
      generation !== loadGeneration
    ) {
      return null;
    }
    ocrRunChain = ocrRunChain
      .catch(() => {})
      .then(() => runNearbyOcr(
        centerPage,
        generation,
        request,
        priorityPage,
      ));
    return ocrRunChain;
  },
});

const traceCapture = createTraceCaptureController({
  elements: {
    button: elements.traceLassoButton,
    status: elements.traceStatus,
    panel: elements.tracePanel,
    preview: elements.tracePreview,
    summary: elements.traceSummary,
    emotionPad: elements.emotionPad,
    emotionMarker: elements.emotionMarker,
    emotionWords: elements.emotionWords,
    returnButton: elements.traceReturnButton,
    pages: elements.pages,
    viewport: elements.viewport,
  },
  traceClient,
  getPageChunks: (pageNumber) => readableChunksForPage(pageNumber),
  getPageCanvas: (pageNumber, shell) => (
    shell?.querySelector("canvas.page-canvas") ??
    pageShells[pageNumber - 1]?.querySelector("canvas.page-canvas") ??
    null
  ),
  getSpeedContext: () => ({
    speedTier: speedTier(lastFlowSpeed).themeKey,
    speedPxPerSecond: lastFlowSpeed,
  }),
  onPause: () => {
    setPlaying(false, { cancelSpeech: false });
    easedSpeed = 0;
    scrollCarry = 0;
  },
  onCancelSpeech: () => {
    cancelSpeechSession("lasso-armed", {
      pausePointScroll: false,
      fade: true,
    });
  },
  onReturnToFlow: ({ interruptionMs }) => {
    beginReadingReflow({
      reason: "trace-return",
      interruptionMs,
    });
  },
});

const traceBook = createTraceBookController({
  elements: {
    openButton: elements.traceBookButton,
    panel: elements.bookTracePanel,
    closeButton: elements.bookTraceClose,
    title: elements.bookTraceTitle,
    chart: elements.bookTraceChart,
    list: elements.bookTraceList,
    image: elements.bookTraceImage,
    meta: elements.bookTraceMeta,
    jumpButton: elements.bookTraceJump,
    trashButton: elements.bookTraceTrash,
    trashViewButton: elements.bookTraceTrashView,
    emotionPad: elements.bookEmotionPad,
    emotionMarker: elements.bookEmotionMarker,
    emotionWords: elements.bookEmotionWords,
  },
  traceClient,
  onOpen: () => setPlaying(false),
  onJump: jumpToTracePage,
});

function emptyRenderSnapshot() {
  const budget = cacheBudgetForDeviceMemory(deviceMemoryGb, {
    ocrEnabled: ocrWorkloadActive,
  });
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
      workloadActive: ocrWorkloadActive,
      running: Boolean(ocrAbortController),
      cachedPages: ocrTextCache.size,
      lastError: ocrLastError,
      taskPages: [...ocrTaskByPage.keys()],
      failedPages: [...ocrFailureByPage.keys()],
      currentPageState: activeReadingPage
        ? textSourceStateForPage(activeReadingPage)
        : null,
      currentPageNativeAssessment: activeReadingPage
        ? nativeTextAssessments.get(activeReadingPage) ?? null
        : null,
      currentPageOcrAssessment: activeReadingPage
        ? ocrTextAssessments.get(activeReadingPage) ?? null
        : null,
    },
    readableChunks: collectReadableChunkDiagnostics(),
    credential: {
      bridge: credentialBridgeState,
      hasApiKey: Boolean(activeCredentialApiKey),
    },
    tts: {
      controller: ttsController.snapshot(),
      scheduler: ttsScheduler.snapshot(),
      audio: ttsAudioPlayer.snapshot(),
      utteranceLocked: ttsUtteranceLocked,
    },
  };
}

function collectTtsChainDiagnostics() {
  const page = activeReadingPage || currentPageNumber();
  const chunks = page ? readableChunksForPage(page) : [];
  const normalizedReadingY = page ? normalizedReadingLineForPage(page) : null;
  const currentPick = page
    ? pickReadableChunk(chunks, { normalizedReadingY: normalizedReadingY ?? 0.38 })
    : null;
  return {
    ui: {
      readyToMove,
      playing,
      controlsHidden: Boolean(elements.ttsControls?.hidden),
      controlAllowed: isTtsControlAllowed(),
      tier: speedTier(speed).themeKey,
      ttsTierEnabled: isTtsTierEnabled(),
      warmupStatus: ttsWarmupStatus,
      warmupActiveKey: ttsWarmupActiveKey,
      warmupReadyKeys: [...ttsWarmupReadyKeys].sort(),
      utteranceLocked: ttsUtteranceLocked,
      lineVisible: Boolean(document.querySelector(".tts-focus")),
      modeButtonText: elements.ttsModeButton?.textContent ?? null,
      statusText: elements.ttsStatus?.textContent ?? null,
    },
    ocr: {
      workloadActive: ocrWorkloadActive,
      running: Boolean(ocrAbortController),
      lastError: ocrLastError,
      cachedPages: ocrReadableChunkCache.size,
      currentPageHasOcrText: page ? ocrTextCache.has(page) : false,
      currentPageHasOcrChunks: page ? (ocrReadableChunkCache.get(page)?.length ?? 0) > 0 : false,
      currentPageState: page ? textSourceStateForPage(page) : null,
      currentPageNativeAssessment: page
        ? nativeTextAssessments.get(page) ?? null
        : null,
      currentPageOcrAssessment: page
        ? ocrTextAssessments.get(page) ?? null
        : null,
    },
    page: {
      page,
      normalizedReadingY,
      chunkCount: chunks.length,
      currentPick: previewPickedChunk(currentPick),
    },
    controller: ttsController.snapshot(),
    scheduler: ttsScheduler.snapshot(),
    audio: ttsAudioPlayer.snapshot(),
  };
}

function updateTtsDiagnosticsPanel(extra = null) {
  if (!elements.ttsDiagnosticsOutput) return;
  const snapshot = collectTtsChainDiagnostics();
  elements.ttsDiagnosticsOutput.textContent = JSON.stringify(extra ? { ...snapshot, selfTest: extra } : snapshot, null, 2);
}

async function runTtsSelfTest() {
  const startedAt = performance.now();
  const result = {
    ok: false,
    stage: "start",
    elapsedMs: 0,
    bytes: 0,
    contentType: null,
    error: null,
  };
  try {
    result.stage = "fetch ./tts/kokoro";
    const response = await fetch("./tts/kokoro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "希声诊断", language: "zh", voice: "zf_xiaobei", speed: 1.2 }),
    });
    result.status = response.status;
    result.contentType = response.headers.get("Content-Type");
    result.provider = response.headers.get("X-TTS-Provider");
    result.language = response.headers.get("X-TTS-Language");
    result.voice = response.headers.get("X-TTS-Voice");
    result.model = response.headers.get("X-TTS-Model");
    result.speed = response.headers.get("X-TTS-Speed");
    if (!response.ok) throw new Error(await response.text());
    const buffer = await response.arrayBuffer();
    result.bytes = buffer.byteLength;
    result.stage = "decode";
    const ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    result.duration = decoded.duration;
    await ctx.close?.();
    result.ok = buffer.byteLength > 44 && decoded.duration > 0;
    result.stage = "done";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    result.elapsedMs = Math.round(performance.now() - startedAt);
    updateTtsDiagnosticsPanel(result);
  }
  return result;
}

function toggleTtsDiagnosticsPanel(force = undefined) {
  if (!elements.ttsDiagnosticsPanel) return;
  const nextHidden = force === undefined ? !elements.ttsDiagnosticsPanel.hidden : !force;
  elements.ttsDiagnosticsPanel.hidden = nextHidden;
  if (!nextHidden) updateTtsDiagnosticsPanel();
}

window.pdfFlowReaderTtsDiagnostics = Object.freeze({
  snapshot: collectTtsChainDiagnostics,
  selfTest: runTtsSelfTest,
  show: () => toggleTtsDiagnosticsPanel(true),
  hide: () => toggleTtsDiagnosticsPanel(false),
});

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

function saveLocalState(nextState = localState) {
  localState = writeLocalState(nextState);
  renderHomeEcho();
}

function displayTitle(fileName) {
  return String(fileName || "未命名 PDF").replace(/\.pdf$/i, "");
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatProgress(record) {
  const percent = Math.round((record.progressRatio ?? 0) * 100);
  if (record.lastPageIndex > 0 && percent > 0) return `第 ${record.lastPageIndex} 页 · ${percent}%`;
  if (record.lastPageIndex > 0) return `第 ${record.lastPageIndex} 页`;
  return "还在书页开头";
}

function formatEstimateRange(min, max, unit) {
  const low = Math.round(Number(min) || 0);
  const high = Math.round(Number(max) || 0);
  if (!low && !high) return "";
  if (!high || high === low) return `约 ${numberFormat.format(low)} ${unit}`;
  return `约 ${numberFormat.format(low)}–${numberFormat.format(high)} ${unit}`;
}

function createHomeBookButton(item, index, length) {
  const button = document.createElement("button");
  const isNewBook = item.type === "new";
  const record = item.record ?? null;
  const title = isNewBook ? "打开一本新书" : displayTitle(record.fileName);
  const palette = paletteForBook(item.id);

  button.className = `recent-book-card${isNewBook ? " is-new-book" : ""}`;
  button.type = "button";
  button.dataset.bookIndex = String(index);
  if (record?.id) button.dataset.documentId = record.id;
  button.setAttribute("role", "option");
  button.setAttribute("aria-label", isNewBook
    ? "打开一本新的 PDF"
    : `继续阅读《${title}》，${formatProgress(record)}`);
  button.style.setProperty("--book-base", palette.base);
  button.style.setProperty("--book-deep", palette.deep);
  button.style.setProperty("--book-ink", palette.ink);
  button.style.setProperty("--book-glow", palette.glow);
  button.style.setProperty("--book-delay", `${Math.min(index, 6) * 55}ms`);
  button.innerHTML = `
    <span class="book-spine" aria-hidden="true">
      <span>${isNewBook ? "NEW BOOK" : "READING ECHO"}</span>
    </span>
    <span class="book-cover">
      <span class="book-cover-kicker">${isNewBook ? "A BLANK PAGE AWAITS" : "THE NIGHT SHELF"}</span>
      <span class="book-cover-ornament" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="recent-book-title"></span>
      <span class="book-cover-rule" aria-hidden="true"></span>
      <span class="recent-book-progress"></span>
      <span class="recent-book-rhythm"></span>
      <span class="book-cover-sequence"></span>
    </span>
    <span class="book-page-edge" aria-hidden="true"></span>
  `;
  button.querySelector(".recent-book-title").textContent = title;
  button.querySelector(".recent-book-progress").textContent = isNewBook
    ? "选择或拖入 PDF"
    : formatProgress(record);
  button.querySelector(".recent-book-rhythm").textContent = isNewBook
    ? "从一页留白开始"
    : `${speedTier(record.lastSpeedPxPerSecond).name} · ${record.lastSpeedPxPerSecond} px/s`;
  button.querySelector(".book-cover-sequence").textContent = isNewBook
    ? "OPEN / LOCAL"
    : bookSequenceLabel(index, length);
  return button;
}

function selectedHomeBook() {
  return homeBookItems[homeBookIndex] ?? homeBookItems[0] ?? null;
}

function updateHomeBookCarousel({ focus = false } = {}) {
  const length = homeBookItems.length;
  if (!length) return;
  homeBookIndex = moveCarouselIndex(homeBookIndex, length, 0);
  const selected = selectedHomeBook();
  homeBookSelectedId = selected?.id ?? null;

  let selectedCard = null;
  for (const card of elements.recentBooks.querySelectorAll(".recent-book-card")) {
    const index = Number(card.dataset.bookIndex);
    const placement = carouselOffset(index, homeBookIndex, length);
    const isSelected = index === homeBookIndex;
    card.dataset.offset = String(placement.offset);
    card.classList.toggle("is-selected", isSelected);
    card.classList.toggle("is-outside", placement.hidden);
    card.setAttribute("aria-selected", String(isSelected));
    card.setAttribute("aria-hidden", String(placement.hidden));
    card.tabIndex = isSelected ? 0 : -1;
    if (isSelected) selectedCard = card;
  }

  const isNewBook = selected?.type === "new";
  const record = selected?.record ?? null;
  elements.bookSelectionTitle.textContent = isNewBook
    ? "打开一本新书"
    : displayTitle(record.fileName);
  elements.bookSelectionMeta.textContent = isNewBook
    ? "选择或拖入 PDF，书页只在本机打开。"
    : `${formatProgress(record)} · ${speedTier(record.lastSpeedPxPerSecond).name} · 确认后请选择原 PDF`;
  elements.takeBook.textContent = isNewBook ? "打开新书" : "取下这本书";
  elements.openNewBook.hidden = isNewBook;
  elements.resumeHint.hidden = true;
  elements.bookPrev.disabled = length <= 1;
  elements.bookNext.disabled = length <= 1;
  if (focus) selectedCard?.focus({ preventScroll: true });
}

function selectHomeBook(index, options = {}) {
  if (!homeBookItems.length) return;
  homeBookIndex = moveCarouselIndex(index, homeBookItems.length, 0);
  updateHomeBookCarousel(options);
}

function moveHomeBook(delta, options = {}) {
  if (homeBookItems.length <= 1) return;
  homeBookIndex = moveCarouselIndex(homeBookIndex, homeBookItems.length, delta);
  updateHomeBookCarousel(options);
}

function clearHomeBookTakingState() {
  globalThis.clearTimeout(homeBookTakeTimer);
  homeBookTakeTimer = 0;
  elements.homeEcho.classList.remove("is-taking");
  elements.recentBooks.querySelector(".recent-book-card.is-taking")?.classList.remove("is-taking");
  updateHomeBookCarousel();
}

function takeSelectedHomeBook() {
  const selected = selectedHomeBook();
  if (!selected || elements.homeEcho.classList.contains("is-taking")) return;
  pendingResumeRecord = selected.type === "recent" ? selected.record : null;
  elements.homeEcho.classList.add("is-taking");
  elements.recentBooks.querySelector(".recent-book-card.is-selected")?.classList.add("is-taking");
  elements.bookSelectionTitle.textContent = selected.type === "recent"
    ? `正在取下《${displayTitle(selected.record.fileName)}》`
    : "正在翻开一页留白";
  elements.bookSelectionMeta.textContent = selected.type === "recent"
    ? "稍后请选择同一份原 PDF，书签会回到上次停下的位置。"
    : "选择一份 PDF，开始新的阅读。";

  const launchDelay = reducedMotion.matches ? 0 : 520;
  homeBookTakeTimer = globalThis.setTimeout(() => {
    elements.documentName.textContent = selected.type === "recent"
      ? `请选择《${displayTitle(selected.record.fileName)}》继续阅读`
      : "选择一份 PDF 放上书架";
    elements.filePicker.click();
    homeBookTakeTimer = globalThis.setTimeout(
      clearHomeBookTakingState,
      reducedMotion.matches ? 0 : 900,
    );
  }, launchDelay);
}

function renderHomeEcho() {
  const recent = recentDocumentRecords(localState);
  const recentItems = recent.map((record) => ({
    id: record.id,
    type: "recent",
    record,
  }));
  homeBookItems = [...recentItems, { id: "new-book", type: "new", record: null }];
  const selectedIndex = homeBookItems.findIndex((item) => item.id === homeBookSelectedId);
  homeBookIndex = selectedIndex >= 0 ? selectedIndex : 0;

  elements.homeEcho.hidden = false;
  elements.emptyState.classList.add("has-book-carousel");
  elements.homeEcho.classList.remove("is-ready", "is-taking");
  elements.clearRecords.hidden = recent.length === 0;
  elements.recentBooks.replaceChildren(
    ...homeBookItems.map((item, index) => createHomeBookButton(item, index, homeBookItems.length)),
  );
  updateHomeBookCarousel();
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(() => elements.homeEcho.classList.add("is-ready"));
  });

  const echo = latestRhythmEcho(localState);
  elements.rhythmEcho.hidden = !echo;
  if (echo) {
    const cjk = formatEstimateRange(
      echo.estimatedCharsPerMinuteMin,
      echo.estimatedCharsPerMinuteMax,
      "字/分",
    );
    const english = formatEstimateRange(
      echo.estimatedWordsPerMinuteMin,
      echo.estimatedWordsPerMinuteMax,
      "词/分",
    );
    const estimateText = [cjk, english].filter(Boolean).join("，");
    elements.rhythmEcho.innerHTML = `
      <p class="rhythm-echo-title">阅读回声</p>
      <p class="rhythm-echo-line"></p>
      <p class="rhythm-echo-meta"></p>
    `;
    elements.rhythmEcho.querySelector(".rhythm-echo-line").textContent =
      `在阅读《${displayTitle(echo.fileName)}》时，你凝神静听。`;
    elements.rhythmEcho.querySelector(".rhythm-echo-meta").textContent =
      `${echo.maxBandName} · ${echo.maxSpeedPxPerSecond} px/s${estimateText ? ` · ${estimateText}` : ""}`;
  }
}

function applyPatternMode(mode = localState.preferences.rhythmPatternMode) {
  const nextMode = mode === "clear" ? "clear" : "soft";
  document.documentElement.dataset.patternMode = nextMode;
}

function currentTtsPolicy() {
  return ttsController.getPolicy();
}

function ttsMasterHelp(snapshot = ttsController.snapshot()) {
  return snapshot.enabled
    ? snapshot.behavior
    : "希声静默；按 H 或按钮开启";
}

function isPointReadPolicy(policy = currentTtsPolicy()) {
  return Boolean(policy?.controls?.pointReadControlVisible);
}

function setTtsStatusText(text = "") {
  if (elements.ttsStatus) elements.ttsStatus.textContent = text;
  if (elements.ttsPointReadStatus) {
    elements.ttsPointReadStatus.textContent = text;
    elements.ttsPointReadStatus.title = text;
    const passive = (
      text.startsWith("希声静默") ||
      text.startsWith("点句朗读开启后") ||
      text.startsWith("点击 PDF 中的完整句子")
    );
    elements.ttsPointReadStatus.hidden = !isPointReadPolicy() || !text || passive;
  }
}

function ttsTextWaitHelp(pageNumber = activeReadingPage || currentPageNumber()) {
  const sourceState = textSourceStateForPage(pageNumber);
  if (sourceState.state === "checking-native") return "正在检查当前页的原生文字";
  if (sourceState.state === "ocr-scheduled") return "扫描已排队，稍后会辨认附近页";
  if (sourceState.state === "ocr-running") return "正在从扫描页中辨认可朗读文字";
  if (sourceState.state === "ocr-failed") return "扫描未完成，可在页面边缘点按重试";
  if (sourceState.state === "ocr-poor") return "扫描完成，但本页仍没有足够的可朗读文字";
  return "当前页还没有可朗读文字";
}

function isTtsTierEnabled() {
  const policy = currentTtsPolicy();
  return Boolean(policy.enabled && isTtsTierImplemented(policy));
}

function isTtsTierImplemented(policy = currentTtsPolicy()) {
  return [
    "snow-mist",
    "aesthetic-walk",
    "long-day",
    "winding-stream",
    "strong-wind",
    "all-things-flourish",
  ].includes(policy.tierKey);
}

function isTtsControlAllowed() {
  return Boolean(readyToMove && activePdf);
}

function currentPageHasLineSpeechTarget() {
  const pageNumber = activeReadingPage || currentPageNumber();
  if (!pageNumber) return false;
  return Boolean(pickReadableSentenceBelowLine(
    readableChunksForPage(pageNumber),
    { normalizedReadingY: normalizedReadingLineForPage(pageNumber) },
  ));
}

function updateManualReadControl() {
  if (!elements.ttsManualReadButton) return;
  const policy = currentTtsPolicy();
  const visible = Boolean(
    isTtsControlAllowed() &&
    policy.enabled &&
    policy.manual.action === "read-line-sentence"
  );
  elements.ttsManualReadButton.hidden = !visible;
  elements.ttsManualReadButton.disabled = !visible || !currentPageHasLineSpeechTarget();
}

function currentTtsWarmupRequest(pageNumber = activeReadingPage || currentPageNumber()) {
  if (!pageNumber) return null;
  return createTtsWarmupRequest([
    ...readableChunksForPage(pageNumber),
    ...continuousSpeechPrefetchChunks(pageNumber, currentTtsPolicy()),
  ]);
}

function isTtsWarmupReady(request = currentTtsWarmupRequest()) {
  return Boolean(
    request?.runtimeKeys?.length &&
    request.runtimeKeys.every((key) => ttsWarmupReadyKeys.has(key))
  );
}

function ensureTtsRuntimeActive(reason = "tts-visible") {
  if (!isTtsControlAllowed() || !ttsController.isEnabled() || !isTtsTierEnabled()) {
    return;
  }
  const warmupRequest = currentTtsWarmupRequest();
  if (!warmupRequest) return;
  ttsAudioPlayer.setMuted(false);
  localState = updateTtsPreferences(localState, { ttsMuted: false });
  writeLocalState(localState);
  renderTtsReadingLine(activeReadingPage || currentPageNumber(), { phase: "tracking" });
  if (ttsRuntimeActivationPromise) return;
  const context = {
    controllerGeneration: ttsController.getGeneration(),
    tierKey: currentTtsPolicy().tierKey,
    warmupKey: warmupRequest.key,
  };
  const contextIsCurrent = () => Boolean(
    ttsController.isEnabled() &&
    isTtsTierEnabled() &&
    ttsController.getGeneration() === context.controllerGeneration &&
    currentTtsPolicy().tierKey === context.tierKey &&
    currentTtsWarmupRequest()?.key === context.warmupKey
  );
  ttsRuntimeActivationPromise = Promise.resolve()
    .then(async () => {
      let ready = await warmupTtsProvider(warmupRequest);
      if (ready !== true && contextIsCurrent()) {
        ready = await warmupTtsProvider(warmupRequest);
      }
      if (ready !== true || !contextIsCurrent()) return false;
      renderTtsReadingLine(activeReadingPage || currentPageNumber(), { phase: "tracking" });
      updateTtsSchedulerDiagnostics(activeReadingPage || currentPageNumber());
      return true;
    })
    .catch(() => {})
    .finally(() => {
      const contextChanged = !contextIsCurrent();
      ttsRuntimeActivationPromise = null;
      refreshTtsRuntimeStatus();
      publishDiagnostics();
      if (
        contextChanged &&
        ttsController.isEnabled() &&
        isTtsTierEnabled()
      ) {
        ensureTtsRuntimeActive("warmup-context-changed");
      }
    });
}

function syncTtsControlVisibility() {
  if (!elements.ttsControls || !elements.ttsPointReadButton) return;
  const allowed = isTtsControlAllowed();
  const pointReadVisible = Boolean(
    allowed && isPointReadPolicy()
  );
  elements.ttsControls.hidden = !allowed || pointReadVisible;
  elements.ttsPointReadButton.hidden = !pointReadVisible;
  if (!pointReadVisible) elements.ttsPointReadStatus.hidden = true;
  const implemented = isTtsTierImplemented();
  elements.ttsModeButton.disabled = Boolean(!implemented && !ttsController.isEnabled());
  updateManualReadControl();
  syncPointReadSurfaces();
  if (allowed) ensureTtsRuntimeActive("tts-control-visible");
}

function pointReadIsActive() {
  return Boolean(pointReadSession.snapshot().active || pointReadScrollHold);
}

function setPointReadBusy(phase = null) {
  if (!elements.ttsPointReadButton) return;
  const busy = ["warming", "synthesizing", "playing"].includes(phase);
  elements.ttsPointReadButton.setAttribute("aria-busy", String(busy));
}

function cancelPointReadInteraction(reason = "cancelled", { pauseScroll = true } = {}) {
  const wasActive = pointReadIsActive();
  pointReadSession.cancel(reason);
  pointReadScrollHold = false;
  pointReadGesture = null;
  clearPointReadHighlight();
  setPointReadBusy(null);
  if (wasActive && pauseScroll && playing) {
    setPlaying(false, { cancelSpeech: false });
  }
  return wasActive;
}

function settlePointReadPlayback(outcome = "ended", token = null) {
  const current = pointReadSession.snapshot();
  const activeToken = token ?? current.token ?? null;
  if (!activeToken) return false;
  const settled = pointReadSession.settle(activeToken, { outcome });
  if (!settled.accepted) return false;
  pointReadScrollHold = false;
  clearPointReadHighlight();
  setPointReadBusy(null);
  if (settled.shouldResume && Number.isFinite(settled.resumeSpeed)) {
    speed = settled.resumeSpeed;
    elements.speed.value = String(speed);
    updateSpeedPresentation("initial");
  }
  refreshTtsRuntimeStatus();
  return true;
}

function cancelSpeechSession(reason = "cancelled", options = {}) {
  const schedulerBeforeCancel = ttsScheduler.snapshot();
  const interruptedRuntime = Boolean(
    schedulerBeforeCancel.active ||
    schedulerBeforeCancel.prefetches?.some((slot) => !slot.ready) ||
    (schedulerBeforeCancel.prefetch?.kind === "explicit" && !schedulerBeforeCancel.prefetch.ready)
  );
  if (!options.preservePointRequest) {
    cancelPointReadInteraction(reason, {
      pauseScroll: options.pausePointScroll !== false,
    });
  }
  cancelTtsSession({
    controller: ttsController,
    scheduler: ttsScheduler,
    audioPlayer: ttsAudioPlayer,
    clearFocus: clearTtsFocus,
    setUtteranceLocked: (locked) => {
      ttsUtteranceLocked = locked;
    },
  }, reason, options);
  if (interruptedRuntime) {
    ttsWarmupReadyKeys.clear();
    ttsWarmupStatus = "idle";
    ttsWarmupActiveKey = null;
  }
  refreshTtsRuntimeStatus();
  publishDiagnostics();
}

function enforceTtsAvailability(reason = "tts-availability") {
  const nextTierKey = speedTier(speed).themeKey;
  if (shouldCancelPolicyTransition({
    enabled: ttsController.isEnabled(),
    previousTierKey: activeTtsTierKey,
    nextTierKey,
  })) {
    cancelSpeechSession("policy-changed");
  }
  activeTtsTierKey = nextTierKey;
  renderTtsReadingLine(activeReadingPage || currentPageNumber(), {
    phase: "tracking",
  });
  updateTtsUi(ttsController.snapshot());
  syncTtsControlVisibility();
}

function warmupTtsProvider(request = currentTtsWarmupRequest()) {
  if (!isTtsControlAllowed() || !request) return Promise.resolve(false);
  if (isTtsWarmupReady(request)) {
    ttsWarmupStatus = "ready";
    return Promise.resolve(true);
  }
  if (ttsWarmupPromise) {
    return ttsWarmupPromise.then(() => (
      isTtsWarmupReady(request) ? true : warmupTtsProvider(request)
    ));
  }
  ttsWarmupStatus = "loading";
  ttsWarmupActiveKey = request.key;
  updateTtsUi({
    ...ttsController.snapshot(),
    behavior: "正在预热当前文字的本地语音",
  });
  ttsWarmupPromise = Promise.resolve()
    .then(() => ttsProvider?.preload?.({
      text: request.text,
      language: request.language,
    }))
    .then(() => {
      for (const key of request.runtimeKeys) ttsWarmupReadyKeys.add(key);
      ttsWarmupStatus = "ready";
      refreshTtsRuntimeStatus();
      return true;
    })
    .catch((error) => {
      if (error?.name === "AbortError") {
        ttsWarmupStatus = "idle";
        return false;
      }
      ttsWarmupStatus = "failed";
      setTtsStatusText(`本地语音预热失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    })
    .finally(() => {
      if (ttsWarmupActiveKey === request.key) ttsWarmupActiveKey = null;
      ttsWarmupPromise = null;
      publishDiagnostics();
    });
  return ttsWarmupPromise;
}

function clearTtsFocus() {
  document.querySelectorAll(".tts-focus").forEach((node) => node.remove());
  pageShells.forEach((shell) => {
    shell.classList.remove("has-tts-focus");
    delete shell.dataset.ttsFocusPhase;
  });
}

function shouldShowTtsLine() {
  const policy = currentTtsPolicy();
  return Boolean(
    readyToMove &&
    activePdf &&
    policy.enabled &&
    policy.readingLine.visible
  );
}

function ensureTtsFocusElement(shell) {
  let focus = shell.querySelector(":scope > .tts-focus");
  if (!focus) {
    focus = document.createElement("div");
    focus.className = "tts-focus";
    focus.setAttribute("aria-hidden", "true");
    shell.append(focus);
  }
  return focus;
}

function renderTtsReadingLine(pageNumber = activeReadingPage, { phase = "tracking", normalizedY = null } = {}) {
  if (!shouldShowTtsLine() || !pageNumber) {
    clearTtsFocus();
    return;
  }
  const shell = pageShells[pageNumber - 1];
  if (!shell) return;
  for (const otherShell of pageShells) {
    if (otherShell !== shell) {
      otherShell.querySelector(":scope > .tts-focus")?.remove();
      otherShell.classList.remove("has-tts-focus");
      delete otherShell.dataset.ttsFocusPhase;
    }
  }
  const y = Math.max(0.02, Math.min(0.98, Number.isFinite(normalizedY) ? normalizedY : normalizedReadingLineForPage(pageNumber)));
  const focus = ensureTtsFocusElement(shell);
  focus.dataset.phase = phase;
  focus.style.left = "0";
  focus.style.top = `${y * 100}%`;
  focus.style.width = "100%";
  shell.classList.add("has-tts-focus");
  shell.dataset.ttsFocusPhase = phase;
}

function renderTtsFocus(pick, { phase = "queued" } = {}) {
  if (!pick?.chunk?.normalizedBbox) {
    renderTtsReadingLine(activeReadingPage, { phase });
    return;
  }
  const pageNumber = Number(pick.chunk.pageIndex ?? 0) + 1;
  const box = pick.chunk.normalizedBbox;
  const y = Math.max(0.02, Math.min(0.98, (Number(box.y) || 0) + (Number(box.height) || 0.03) / 2));
  renderTtsReadingLine(pageNumber, { phase, normalizedY: y });
}

function clearPointReadHighlight() {
  document.querySelectorAll(".point-read-highlight-layer").forEach((node) => node.remove());
}

function clearPointReadTextLayers() {
  document.querySelectorAll(".point-read-text-layer").forEach((node) => node.remove());
  document.documentElement.dataset.pointRead = "off";
}

function pointTargetByKey(key) {
  if (!key) return null;
  for (const pageNumber of nearbyPageNumbers(activeReadingPage || currentPageNumber())) {
    const target = pointSentenceTargetsForPage(pageNumber).find((entry) => entry.key === key);
    if (target) return target;
  }
  return null;
}

function renderPointReadHighlight(target, { phase = "hover" } = {}) {
  if (!target?.fragments?.length) {
    clearPointReadHighlight();
    return;
  }
  const pageNumber = Number(target.pageIndex ?? -1) + 1;
  const shell = pageShells[pageNumber - 1];
  if (!shell) return;
  clearPointReadHighlight();
  const layer = document.createElement("div");
  layer.className = "point-read-highlight-layer";
  layer.dataset.phase = phase;
  layer.dataset.targetKey = target.key;
  layer.setAttribute("aria-hidden", "true");
  for (const fragment of target.fragments) {
    const box = fragment.normalizedBbox;
    if (!box) continue;
    const marker = document.createElement("span");
    marker.className = "point-read-highlight-fragment";
    marker.style.left = `${box.x * 100}%`;
    marker.style.top = `${box.y * 100}%`;
    marker.style.width = `${box.width * 100}%`;
    marker.style.height = `${box.height * 100}%`;
    layer.append(marker);
  }
  shell.append(layer);
  requestAnimationFrame(() => {
    if (layer.isConnected) layer.dataset.phase = phase;
  });
}

function renderPointReadTextLayer(pageNumber, targets) {
  const shell = pageShells[pageNumber - 1];
  if (!shell) return;
  shell.querySelector(":scope > .point-read-text-layer")?.remove();
  if (!targets.length) return;
  const layer = document.createElement("div");
  layer.className = "point-read-text-layer";
  layer.dataset.page = String(pageNumber);
  layer.setAttribute("aria-label", `第 ${pageNumber} 页可选择文字`);
  for (const target of targets) {
    for (const fragment of target.fragments ?? []) {
      const box = fragment.normalizedBbox;
      const text = String(fragment.text ?? "");
      if (!box || !text) continue;
      const span = document.createElement("span");
      span.className = "point-read-text-fragment";
      span.dataset.pointSentenceKey = target.key;
      span.style.left = `${box.x * 100}%`;
      span.style.top = `${box.y * 100}%`;
      span.style.width = `${box.width * 100}%`;
      span.style.height = `${box.height * 100}%`;
      span.style.fontSize = `${Math.max(7, box.height * shell.clientHeight * 0.9)}px`;
      span.textContent = text;
      layer.append(span);
    }
  }
  shell.append(layer);
}

function syncPointReadSurfaces() {
  const enabled = Boolean(
    readyToMove &&
    activePdf &&
    ttsController.isEnabled() &&
    isPointReadPolicy()
  );
  if (!enabled) {
    clearPointReadHighlight();
    clearPointReadTextLayers();
    return;
  }
  document.documentElement.dataset.pointRead = "on";
  const nearby = new Set(nearbyPageNumbers(activeReadingPage || currentPageNumber()));
  for (let index = 0; index < pageShells.length; index += 1) {
    const pageNumber = index + 1;
    if (!nearby.has(pageNumber)) {
      pageShells[index].querySelector(":scope > .point-read-text-layer")?.remove();
      continue;
    }
    renderPointReadTextLayer(pageNumber, pointSentenceTargetsForPage(pageNumber));
  }
  const session = pointReadSession.snapshot();
  const activeKey = session.targetKey ?? session.activeTargetKey ?? null;
  if (session.active && activeKey) {
    const target = pointTargetByKey(activeKey);
    if (target) renderPointReadHighlight(target, { phase: session.phase ?? "queued" });
  }
}

function updateTtsUi(state = ttsController?.snapshot?.()) {
  if (!elements.ttsModeButton || !elements.ttsStatus || !elements.ttsPointReadButton) return;
  const enabled = Boolean(state?.enabled ?? localState.preferences.ttsEnabled);
  const policy = state?.policy ?? currentTtsPolicy();
  elements.ttsModeButton.textContent = `希声：${enabled ? "开" : "关"}`;
  elements.ttsModeButton.dataset.enabled = String(enabled);
  elements.ttsModeButton.setAttribute("aria-pressed", String(enabled));
  elements.ttsModeButton.title = "H：开启或关闭希声；Esc：止声";
  elements.ttsPointReadButton.textContent = `点击以朗读：${enabled ? "开" : "关"}`;
  elements.ttsPointReadButton.dataset.enabled = String(enabled);
  elements.ttsPointReadButton.setAttribute("aria-pressed", String(enabled));
  elements.ttsPointReadButton.title = "H：开启或关闭点击朗读；Esc：止声";
  updateManualReadControl();
  elements.ttsModeButton.disabled = false;
  elements.ttsPointReadButton.disabled = false;
  if (state?.status === "waiting-for-readable-chunk") {
    setTtsStatusText(ttsTextWaitHelp());
    return;
  }
  setTtsStatusText(state?.behavior ?? (
    enabled ? policy.behavior : "希声静默；按 H 或按钮开启"
  ));
}

function refreshTtsRuntimeStatus() {
  if (!elements.ttsStatus) return;
  const controller = ttsController.snapshot();
  const scheduler = ttsScheduler.snapshot();
  const audio = ttsAudioPlayer.snapshot();
  if (!controller.enabled) {
    setTtsStatusText(ttsMasterHelp(controller));
    return;
  }
  if (ttsWarmupStatus === "loading") {
    setTtsStatusText(isPointReadPolicy(controller.policy)
      ? "正在准备本地声音，稍后即可点句"
      : "正在预热本地语音，首次约 10–20 秒；完成后会随页面流动");
    return;
  }
  if (scheduler.status === "failed") {
    setTtsStatusText(`希声失败：${scheduler.lastResult?.error ?? "未知错误"}`);
    return;
  }
  if (audio.status === "failed") {
    setTtsStatusText(`播放失败：${audio.error ?? "无法解码音频"}`);
    return;
  }
  if (scheduler.status === "waiting-for-readable-chunk") {
    setTtsStatusText(ttsTextWaitHelp());
    return;
  }
  if (scheduler.status === "queued") {
    const speedText = scheduler.lastSpeech?.speed ? ` · ${Number(scheduler.lastSpeech.speed).toFixed(2)}x` : "";
    setTtsStatusText(scheduler.lastSpeech?.action === "point-sentence"
      ? `正在准备你点到的这句话${speedText}`
      : scheduler.lastSpeech?.manual
        ? `正在准备阅读线下方最近一句${speedText}`
        : `正在准备跟随页面的声音${speedText}`);
    return;
  }
  if (audio.status === "playing") {
    const speedText = scheduler.lastSpeech?.speed ? ` · ${Number(scheduler.lastSpeech.speed).toFixed(2)}x` : "";
    setTtsStatusText(scheduler.lastSpeech?.action === "point-sentence"
      ? `正在读你点到的这句话${speedText}`
      : `${controller.behavior}${speedText}`);
    return;
  }
  if (scheduler.prefetch?.kind === "explicit") {
    setTtsStatusText(scheduler.prefetch.ready
      ? "下一段的首句已经备好，等阅读线越过段尾便会响起"
      : "正在悄悄准备下一段的首句；若来不及，就让它安静过去");
    return;
  }
  setTtsStatusText(controller.behavior ?? ttsMasterHelp(controller));
}

function persistTtsEnabled(enabled) {
  localState = updateTtsPreferences(localState, {
    ttsEnabled: enabled,
    ttsMuted: enabled ? false : localState.preferences.ttsMuted,
  });
  writeLocalState(localState);
  updateTtsUi(ttsController.snapshot());
}

function setTtsEnabled(enabled) {
  const next = Boolean(enabled);
  if (next && !isTtsControlAllowed()) {
    syncTtsControlVisibility();
    setTtsStatusText("PDF 准备好后才能开启希声");
    return false;
  }
  if (!next) {
    cancelSpeechSession("master-off");
    ttsController.setEnabled(false);
    persistTtsEnabled(false);
  } else {
    ttsController.setEnabled(true);
    ttsAudioPlayer.setMuted(false);
    persistTtsEnabled(true);
    renderTtsReadingLine(activeReadingPage || currentPageNumber(), { phase: "tracking" });
  }
  updateOcrControls();
  return true;
}

async function requestLineSpeech() {
  const action = "read-line-sentence";
  const pageNumber = activeReadingPage || currentPageNumber();
  const allowed = () => canRequestManualSpeech({
    readyToMove,
    hasActivePdf: Boolean(activePdf),
    controlAllowed: isTtsControlAllowed(),
    policy: currentTtsPolicy(),
    action,
    hasReadableChunks: currentPageHasLineSpeechTarget(),
  });
  if (!allowed()) {
    syncTtsControlVisibility();
    if (elements.ttsStatus) {
      if (!readyToMove || !activePdf) {
        elements.ttsStatus.textContent = "PDF 准备好后才能朗读";
      } else if (!ttsController.isEnabled()) {
        elements.ttsStatus.textContent = "请先开启希声，再使用 R 朗读";
      } else if (currentTtsPolicy().manual.action !== action) {
        elements.ttsStatus.textContent = "R 只在“长日留痕”中唤起阅读线旁的一句";
      } else if (!currentPageHasLineSpeechTarget()) {
        elements.ttsStatus.textContent = ttsTextWaitHelp(pageNumber);
      } else {
        elements.ttsStatus.textContent = "当前句段暂时不可朗读";
      }
    }
    return false;
  }
  try {
    return await runManualSpeechRequest({
      canRequest: allowed,
      warmup: warmupTtsProvider,
      requestAction: () => ttsController.requestAction(action),
      onReady: () => {
        ttsAudioPlayer.setMuted(false);
        updateTtsSchedulerDiagnostics(activeReadingPage || currentPageNumber());
      },
    });
  } catch {
    refreshTtsRuntimeStatus();
    return false;
  }
}

async function requestPointSpeech(target) {
  const action = "point-sentence";
  const pageNumber = Number(target?.pageIndex ?? -1) + 1;
  const targetIsCurrent = () => Boolean(
    target?.key &&
    pointSentenceTargetsForPage(pageNumber).some((entry) => entry.key === target.key)
  );
  const allowed = () => canRequestManualSpeech({
    readyToMove,
    hasActivePdf: Boolean(activePdf),
    controlAllowed: isTtsControlAllowed(),
    policy: currentTtsPolicy(),
    action,
    hasReadableChunks: targetIsCurrent(),
  });
  if (!allowed()) {
    setTtsStatusText(target?.key ? "请先开启“点击以朗读”" : ttsTextWaitHelp(pageNumber));
    return false;
  }

  const request = pointReadSession.begin({
    targetKey: target.key,
    wasPlaying: playing,
    speed,
  });
  pointReadScrollHold = pointReadSession.snapshot().holdActive;
  if (request.shouldPause) {
    easedSpeed = 0;
    scrollCarry = 0;
  }
  cancelSpeechSession("point-replaced", {
    preservePointRequest: true,
    fade: false,
  });
  pointReadSession.markPhase(request.token, "warming");
  setPointReadBusy("warming");
  renderPointReadHighlight(target, { phase: "warming" });
  setTtsStatusText("正在准备你点到的这句话");

  const requestIsCurrent = () => Boolean(
    pointReadSession.isCurrent(request.token) &&
    allowed()
  );
  try {
    const ready = await warmupTtsProvider();
    if (ready !== true || !requestIsCurrent()) {
      if (pointReadSession.isCurrent(request.token)) {
        settlePointReadPlayback("failed", request.token);
      }
      return false;
    }
    const speechTarget = {
      ...target,
      speechKey: target.key,
      pointReadRequestId: request.token,
    };
    if (!ttsController.requestTarget(action, speechTarget)) {
      settlePointReadPlayback("failed", request.token);
      return false;
    }
    pointReadSession.markPhase(request.token, "synthesizing");
    setPointReadBusy("synthesizing");
    renderPointReadHighlight(target, { phase: "queued" });
    const box = target.normalizedBbox;
    const result = await ttsController.tick({
      isPlaying: false,
      chunks: [],
      normalizedReadingY: Math.max(0, Math.min(1,
        Number(box?.y ?? 0) + Number(box?.height ?? 0) / 2,
      )),
      pageNumber,
      documentGeneration: loadGeneration,
    });
    if (!pointReadSession.isCurrent(request.token)) return false;
    if (!result?.chunk) {
      settlePointReadPlayback("failed", request.token);
      return false;
    }
    return true;
  } catch {
    if (pointReadSession.isCurrent(request.token)) {
      settlePointReadPlayback("failed", request.token);
    }
    refreshTtsRuntimeStatus();
    return false;
  }
}

function toggleTtsEnabled() {
  return setTtsEnabled(!ttsController.isEnabled());
}

function speedTierIndex(value) {
  const themeKey = speedTier(value).themeKey;
  return Math.max(0, SPEED_TIERS.findIndex((tier) => tier.themeKey === themeKey));
}

function queueSpeedCue(previousSpeed, nextSpeed) {
  const fromIndex = speedTierIndex(previousSpeed);
  const toIndex = speedTierIndex(nextSpeed);
  if (fromIndex === toIndex) return;
  void speedCueEngine.resume();
  speedCueEngine.queueTierChange(fromIndex, toIndex);
}

function togglePatternMode() {
  const nextMode = localState.preferences.rhythmPatternMode === "clear" ? "soft" : "clear";
  saveLocalState({
    ...localState,
    preferences: {
      ...localState.preferences,
      rhythmPatternMode: nextMode,
    },
  });
  applyPatternMode(nextMode);
}

function isBackgroundClick(event) {
  if (!(event.target instanceof Element)) return false;
  if (!elements.viewport.contains(event.target)) return false;
  return !event.target.closest(
    ".page-shell, canvas, button, label, input, .home-echo, .tagline-cloud, .primary-button, .controls, .ocr-dock, .error-panel",
  );
}

function pointReadTargetAtEvent(event) {
  if (!isPointReadPolicy() || !ttsController.isEnabled()) return null;
  const shell = event.target instanceof Element
    ? event.target.closest(".page-shell")
    : null;
  if (!shell) return null;
  const pageNumber = Number(shell.dataset.page);
  if (!Number.isInteger(pageNumber)) return null;
  const directKey = event.target instanceof Element
    ? event.target.closest("[data-point-sentence-key]")?.dataset.pointSentenceKey
    : null;
  const targets = pointSentenceTargetsForPage(pageNumber);
  if (directKey) {
    const directTarget = targets.find((target) => target.key === directKey);
    if (directTarget) return directTarget;
  }
  const rectangle = shell.getBoundingClientRect();
  if (rectangle.width <= 0 || rectangle.height <= 0) return null;
  return pickPointSentence(targets, {
    x: (event.clientX - rectangle.left) / rectangle.width,
    y: (event.clientY - rectangle.top) / rectangle.height,
    maxDistance: 0.035,
    pageIndex: pageNumber - 1,
  });
}

function interruptPointReadForUser(reason = "user-intervention") {
  if (!pointReadIsActive()) return false;
  pointReadSession.interrupt(reason);
  cancelSpeechSession(reason);
  return true;
}

function updatePointReadHover(event) {
  if (!shouldRenderPointReadHover({
    sessionActive: pointReadIsActive(),
    buttons: event.buttons,
    policyEnabled: isPointReadPolicy(),
    masterEnabled: ttsController.isEnabled(),
    ready: readyToMove,
  })) return;
  const target = pointReadTargetAtEvent(event);
  if (target) {
    renderPointReadHighlight(target, { phase: "hover" });
    setTtsStatusText("单击读这一句；拖动可以选择文字");
  } else {
    clearPointReadHighlight();
    setTtsStatusText(pointSentenceTargetsForPage(activeReadingPage).length
      ? "把鼠标移到一句话上，再轻点一下"
      : ttsTextWaitHelp());
  }
}

function beginPointReadGesture(event) {
  if (
    !isPointReadPolicy() ||
    !ttsController.isEnabled() ||
    event.pointerType === "touch"
  ) {
    return;
  }
  const target = pointReadTargetAtEvent(event);
  pointReadGesture = {
    pointerId: event.pointerId,
    button: event.button,
    pointerType: event.pointerType,
    startX: event.clientX,
    startY: event.clientY,
    movement: 0,
    target,
    targetKey: target?.key ?? null,
    modified: Boolean(event.ctrlKey || event.metaKey || event.altKey),
    interrupted: false,
  };
}

function movePointReadGesture(event) {
  if (pointReadGesture?.pointerId !== event.pointerId) return;
  pointReadGesture.movement = Math.max(
    pointReadGesture.movement,
    Math.hypot(
      event.clientX - pointReadGesture.startX,
      event.clientY - pointReadGesture.startY,
    ),
  );
  if (pointReadGesture.movement > 6 && !pointReadGesture.interrupted) {
    pointReadGesture.interrupted = true;
    interruptPointReadForUser("text-selection");
  }
}

function finishPointReadGesture(event) {
  const gesture = pointReadGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  pointReadGesture = null;
  const upTarget = pointReadTargetAtEvent(event);
  window.setTimeout(() => {
    const selection = window.getSelection?.();
    const activate = shouldActivatePointReadGesture({
      button: gesture.button,
      pointerType: gesture.pointerType,
      movement: Math.max(
        gesture.movement,
        Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY),
      ),
      maxMovement: 6,
      downTargetKey: gesture.targetKey,
      upTargetKey: upTarget?.key ?? null,
      selectionCollapsed: selection ? selection.isCollapsed : true,
      modified: gesture.modified || Boolean(event.ctrlKey || event.metaKey || event.altKey),
    });
    if (activate && upTarget) {
      void requestPointSpeech(upTarget);
    } else if (selection && !selection.isCollapsed) {
      interruptPointReadForUser("text-selection");
    }
  }, 0);
}

function showRestoreMessage(record) {
  window.clearTimeout(restoreMessageTimer);
  elements.loading.hidden = false;
  elements.loadingText.textContent = `回到《${displayTitle(record.fileName)}》上次停下的位置`;
  restoreMessageTimer = window.setTimeout(() => {
    if (diagnosticsSession.firstHighQualityMs !== null) elements.loading.hidden = true;
  }, RESTORE_TOAST_MS);
}

function createFileMetaFromFile(file) {
  return {
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified ?? 0,
    desktopPath: traceClient.pathForFile(file),
  };
}

function jumpToTracePage(trace) {
  if (!trace || activeTraceDocument?.id !== trace.documentId) {
    if (elements.traceStatus) {
      elements.traceStatus.hidden = false;
      elements.traceStatus.textContent = "请先重新选择这本 PDF，再回到原页";
    }
    elements.filePicker.click();
    return false;
  }
  const shell = pageShells[trace.pageIndex];
  if (!shell) return false;
  setPlaying(false);
  cancelReadingReflow("trace-jump");
  elements.viewport.scrollTo({
    top: Math.max(0, shell.offsetTop - 82),
    behavior: reducedMotion.matches ? "auto" : "smooth",
  });
  if (elements.traceStatus) {
    elements.traceStatus.hidden = false;
    elements.traceStatus.textContent = `已回到第 ${trace.pageIndex + 1} 页`;
  }
  return true;
}

async function registerTraceDocument(pdf, displayName) {
  activeTraceDocument = null;
  if (!traceClient.available) {
    traceCapture.setDocument(null);
    traceBook.setDocument(null);
    return null;
  }
  const rawFingerprint = Array.isArray(pdf?.fingerprints)
    ? pdf.fingerprints.find((value) => typeof value === "string" && value.trim())
    : null;
  if (!rawFingerprint) {
    traceCapture.setDocument(null, {
      unavailableReason: "这份 PDF 缺少稳定内容身份，暂不开放航迹",
    });
    traceBook.setDocument(null);
    return null;
  }
  const fingerprint = `pdfjs:${rawFingerprint.trim()}`;
  try {
    activeTraceDocument = await traceClient.registerDocument({
      id: createDocumentId(fingerprint),
      fingerprint,
      displayName,
      lastKnownPath: activeFileMeta?.desktopPath ?? null,
      fileSize: activeFileMeta?.fileSize ?? null,
    });
    traceCapture.setDocument(activeTraceDocument);
    traceBook.setDocument(activeTraceDocument, displayName);
    if (activeDocumentRecord && activeFileMeta) {
      const nextState = upsertDocumentRecord(
        localState,
        { ...activeFileMeta, fingerprint: activeDocumentRecord.fingerprint },
        {
          traceDocumentId: activeTraceDocument.id,
          traceFingerprint: activeTraceDocument.fingerprint,
        },
      );
      saveLocalState(nextState);
      activeDocumentRecord = localState.documents[activeDocumentRecord.id] ?? activeDocumentRecord;
    }
    return activeTraceDocument;
  } catch (error) {
    traceCapture.setDocument(null, {
      unavailableReason: `航迹本地仓库暂不可用：${error.code ?? "TRACE_UNAVAILABLE"}`,
    });
    traceBook.setDocument(null);
    return null;
  }
}

function activateDocumentRecord(fileMeta) {
  const fingerprint = createDocumentFingerprint(fileMeta);
  const id = fileMeta.id ?? undefined;
  const existing = recentDocumentRecords(localState, 18).find(
    (record) => record.fingerprint === fingerprint || (id && record.id === id),
  );
  const nextState = upsertDocumentRecord(
    localState,
    { ...fileMeta, fingerprint },
    {
      lastSpeedPxPerSecond: existing?.lastSpeedPxPerSecond ?? speed,
      lastBandKey: existing?.lastBandKey ?? speedTier(speed).themeKey,
    },
  );
  saveLocalState(nextState);
  activeDocumentRecord = recentDocumentRecords(localState, 18).find(
    (record) => record.fingerprint === fingerprint,
  ) ?? null;
  return activeDocumentRecord;
}

function maybeRestoreReadingPosition() {
  const record = activeDocumentRecord;
  if (
    !record ||
    !localState.preferences.restoreLastPositionEnabled ||
    !pageShells.length ||
    record.lastScrollTop <= 0
  ) {
    return false;
  }
  const maximum = Math.max(0, elements.viewport.scrollHeight - elements.viewport.clientHeight);
  elements.viewport.scrollTop = Math.min(record.lastScrollTop, maximum);
  speed = record.lastSpeedPxPerSecond;
  elements.speed.value = String(speed);
  updateSpeedPresentation("initial");
  showRestoreMessage(record);
  return true;
}

function persistReadingRecord() {
  persistTimer = 0;
  if (!activeDocumentRecord || !activeFileMeta || !activePdf) return;
  const maximum = Math.max(
    1,
    elements.viewport.scrollHeight - elements.viewport.clientHeight,
  );
  const progressRatio = Math.max(0, Math.min(1, elements.viewport.scrollTop / maximum));
  const tier = speedTier(speed);
  let nextState = upsertDocumentRecord(
    localState,
    { ...activeFileMeta, fingerprint: activeDocumentRecord.fingerprint },
    {
      lastPageIndex: activeReadingPage,
      lastScrollTop: Math.round(elements.viewport.scrollTop),
      progressRatio,
      lastSpeedPxPerSecond: speed,
      lastBandKey: tier.themeKey,
    },
  );
  const refreshedRecord = nextState.documents[activeDocumentRecord.id];
  const estimate = computeReadingEstimate();
  if (estimate && estimate.mode !== "empty") {
    nextState = upsertRhythmRecord(nextState, refreshedRecord, {
      speedPxPerSecond: speed,
      bandKey: tier.themeKey,
      bandName: tier.name,
      cjkRateMin: estimate.cjkRate ? Math.round(estimate.cjkRate * 0.88) : 0,
      cjkRateMax: estimate.cjkRate ? Math.round(estimate.cjkRate * 1.12) : 0,
      englishRateMin: estimate.englishRate ? Math.round(estimate.englishRate * 0.88) : 0,
      englishRateMax: estimate.englishRate ? Math.round(estimate.englishRate * 1.12) : 0,
      pageIndex: activeReadingPage,
    });
  }
  saveLocalState(nextState);
  activeDocumentRecord = localState.documents[activeDocumentRecord.id] ?? refreshedRecord;
}

function schedulePersistReadingRecord() {
  if (!activeDocumentRecord || persistTimer) return;
  persistTimer = window.setTimeout(persistReadingRecord, 1_200);
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

function resolvePageTextSource(pageNumber) {
  return resolveTextSourceState({
    nativeKnown: nativeTextAssessments.has(pageNumber),
    nativeAssessment: nativeTextAssessments.get(pageNumber) ?? null,
    ocrKnown: ocrTextAssessments.has(pageNumber),
    ocrAssessment: ocrTextAssessments.get(pageNumber) ?? null,
    ocrTask: ocrTaskByPage.get(pageNumber) ?? null,
    ocrFailed: ocrFailureByPage.has(pageNumber),
  });
}

function textSourceStateForPage(pageNumber) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return resolvePageTextSource(0);
  }
  return pageTextSourceStates.get(pageNumber) ?? resolvePageTextSource(pageNumber);
}

function updateCurrentTextSourceStatus(pageNumber = activeReadingPage) {
  if (!pageNumber || !elements.ocrStatus) return;
  const sourceState = textSourceStateForPage(pageNumber);
  const hasReadyOcrEstimate = (
    sourceState.selectedSource === "native" &&
    ocrTextAssessments.get(pageNumber)?.state === "ready"
  );
  const messages = {
    "checking-native": "正在检查本页的原生文字",
    "native-ready": hasReadyOcrEstimate
      ? "朗读使用原生文字；扫描结果已校准速度估算"
      : "已使用 PDF 原生文字，也可扫描增强速度估算",
    "ocr-needed": "本页原生文字较少，可以扫描补足",
    "ocr-scheduled": "附近页扫描已经排队",
    "ocr-running": "原生文字较少，正在补扫附近页",
    "ocr-ready": "本页已用本地扫描补足文字",
    "ocr-poor": "扫描完成，但本页仍没有足够的可读文字",
    "ocr-failed": "扫描未完成，可以点按重试",
    "ocr-suppressed": "本页暂不自动扫描",
  };
  elements.ocrStatus.hidden = false;
  elements.ocrStatus.textContent = messages[sourceState.state] ?? "";
}

function reconcilePageTextSource(
  pageNumber,
  { allowAutoOcr = false } = {},
) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
    return null;
  }
  const previous = pageTextSourceStates.get(pageNumber) ?? null;
  const next = resolvePageTextSource(pageNumber);
  pageTextSourceStates.set(pageNumber, next);

  if (previous && previous.selectedSource !== next.selectedSource) {
    if (pageNumber === activeReadingPage) {
      cancelSpeechSession("text-source-changed");
    }
    syncPointReadSurfaces();
  }

  if (pageNumber === activeReadingPage) {
    lastEstimateSignature = "";
    renderSpeedEstimate("density");
    updateCurrentTextSourceStatus(pageNumber);
    updateOcrControls();
    if (next.ttsReady && playing) updateTtsSchedulerDiagnostics(pageNumber);
  }

  if (
    allowAutoOcr &&
    pageNumber === activeReadingPage &&
    next.shouldScheduleOcr
  ) {
    scheduleNearbyOcr(pageNumber, { priorityPage: pageNumber });
  }
  publishDiagnostics();
  return next;
}

function clearTextSession() {
  textWindowRequest += 1;
  activeReadingPage = 0;
  lastEstimateSignature = "";
  pageTextCache = new Map();
  pageTextRequests = new Map();
  pageReadableChunkCache = new Map();
  pageParagraphPassageCache = new Map();
  pagePointSentenceCache = new Map();
  ocrTextCache = new Map();
  ocrReadableChunkCache = new Map();
  ocrParagraphPassageCache = new Map();
  ocrPointSentenceCache = new Map();
  paragraphPassageRevisions = new Map();
  paragraphFlowContextState = null;
  ttsParagraphJumpPending = false;
  nativeTextAssessments = new Map();
  ocrTextAssessments = new Map();
  pageTextSourceStates = new Map();
  ocrTaskByPage = new Map();
  ocrFailureByPage = new Map();
  ocrWorkloadActive = false;
  ocrLastError = null;
  ocrScanRequest += 1;
  ocrTaskScheduler.cancel("document-cleared");
  ocrAbortController?.abort();
  ocrAbortController = null;
  ocrProgressPosition = null;
  cancelSpeechSession("document-cleared", { reset: true });
  clearPointReadTextLayers();
  void ocrProvider?.reset?.();
  updateOcrControls();
  updateRenderBudget();
}

function bestPageTextStats(pageNumber) {
  const source = textSourceStateForPage(pageNumber).selectedSource;
  const ocrAssessment = ocrTextAssessments.get(pageNumber) ?? null;
  if (
    ocrTextCache.has(pageNumber) &&
    assessmentSupportsDensity(ocrAssessment)
  ) {
    return ocrTextCache.get(pageNumber);
  }
  if (source === "native") {
    return pageTextCache.get(pageNumber) ?? null;
  }
  if (source === "ocr") return ocrTextCache.get(pageNumber) ?? null;
  return null;
}

function readableChunkPreview(chunk) {
  const text = typeof chunk?.text === "string" ? chunk.text : "";
  return {
    chunkIndex: chunk?.chunkIndex ?? 0,
    role: chunk?.role ?? "unknown",
    languageHint: chunk?.languageHint ?? "unknown",
    yStart: chunk?.yStart,
    yEnd: chunk?.yEnd,
    normalizedYStart: chunk?.normalizedBbox?.y ?? null,
    normalizedYEnd: chunk?.normalizedBbox
      ? chunk.normalizedBbox.y + chunk.normalizedBbox.height
      : null,
    text: text.length > 160 ? `${text.slice(0, 157)}…` : text,
  };
}

function readableChunksForPage(pageNumber) {
  return selectReadableChunks({
    selectedSource: textSourceStateForPage(pageNumber).selectedSource,
    nativeChunks: pageReadableChunkCache.get(pageNumber) ?? [],
    ocrChunks: ocrReadableChunkCache.get(pageNumber) ?? [],
  });
}

function continuousSpeechPrefetchChunks(pageNumber, policy = currentTtsPolicy()) {
  if (!["snow-mist", "aesthetic-walk"].includes(policy?.tierKey)) return [];
  const nextPage = pageNumber + 1;
  if (nextPage > pageCount) return [];
  return readableChunksForPage(nextPage);
}

function pointSentenceTargetsForPage(pageNumber) {
  const selectedSource = textSourceStateForPage(pageNumber).selectedSource;
  const targets = selectedSource === "native"
    ? pagePointSentenceCache.get(pageNumber) ?? []
    : selectedSource === "ocr"
      ? ocrPointSentenceCache.get(pageNumber) ?? []
      : [];
  return targets.filter((target) => (
    ttsController.canSpeakChunk(target, { explicitTarget: true })
  ));
}

function paragraphPassagesForPage(pageNumber) {
  const selectedSource = textSourceStateForPage(pageNumber).selectedSource;
  if (selectedSource === "native") {
    return pageParagraphPassageCache.get(pageNumber) ?? [];
  }
  if (selectedSource === "ocr") {
    return ocrParagraphPassageCache.get(pageNumber) ?? [];
  }
  return [];
}

function bumpParagraphPassageRevision(pageNumber, source) {
  const revisions = paragraphPassageRevisions.get(pageNumber) ?? {
    native: 0,
    ocr: 0,
  };
  paragraphPassageRevisions.set(pageNumber, {
    ...revisions,
    [source]: (revisions[source] ?? 0) + 1,
  });
}

function paragraphPassageRevisionForPage(pageNumber, source) {
  return paragraphPassageRevisions.get(pageNumber)?.[source] ?? 0;
}

function paragraphWindowForPage(pageNumber) {
  const pages = [pageNumber - 1, pageNumber, pageNumber + 1]
    .filter((candidate) => candidate >= 1 && candidate <= pageCount);
  const linked = linkCrossPageParagraphs(
    pages.flatMap((candidate) => paragraphPassagesForPage(candidate)),
  );
  const pageMetrics = new Map(
    pages.map((candidate) => {
      const pageIndex = candidate - 1;
      return [
        pageIndex,
        {
          pageTop: pageTops[pageIndex],
          pageHeight: pageLayout[pageIndex]?.height ??
            pageShells[pageIndex]?.offsetHeight ??
            0,
        },
      ];
    }),
  );
  return materializeParagraphBoundaries(linked, pageMetrics);
}

function paragraphFlowContextKey(pageNumber = activeReadingPage) {
  const pages = [pageNumber - 1, pageNumber, pageNumber + 1]
    .filter((candidate) => candidate >= 1 && candidate <= pageCount);
  const advanced = advanceParagraphFlowContext(paragraphFlowContextState, {
    documentGeneration: loadGeneration,
    controllerGeneration: ttsController.getGeneration(),
    pageNumber,
    windowSources: pages.map((candidate) => {
      const source = textSourceStateForPage(candidate).selectedSource ?? "none";
      return {
        pageNumber: candidate,
        source,
        revision: paragraphPassageRevisionForPage(candidate, source),
      };
    }),
  });
  paragraphFlowContextState = advanced.state;
  return advanced.key;
}

function collectReadableChunkDiagnostics() {
  const nearby = nearbyPageNumbers(activeReadingPage).map((pageNumber) => {
    const sourceState = textSourceStateForPage(pageNumber);
    const chunks = readableChunksForPage(pageNumber);
    return {
      pageNumber,
      state: sourceState.state,
      source: sourceState.selectedSource,
      ready: sourceState.ttsReady,
      count: chunks.length,
      paragraphs: paragraphPassagesForPage(pageNumber).length,
      nativeAssessment: nativeTextAssessments.get(pageNumber) ?? null,
      ocrAssessment: ocrTextAssessments.get(pageNumber) ?? null,
      ocrTask: ocrTaskByPage.get(pageNumber) ?? null,
      ocrError: ocrFailureByPage.get(pageNumber) ?? null,
      preview: chunks.slice(0, 5).map(readableChunkPreview),
    };
  });
  return {
    source: textSourceStateForPage(activeReadingPage).selectedSource,
    state: textSourceStateForPage(activeReadingPage).state,
    cachedPages: {
      native: pageReadableChunkCache.size,
      ocr: ocrReadableChunkCache.size,
      nativeParagraphs: pageParagraphPassageCache.size,
      ocrParagraphs: ocrParagraphPassageCache.size,
    },
    currentPage: activeReadingPage,
    nearby,
  };
}

async function extractPageTextStats(pageNumber, generation) {
  if (generation !== loadGeneration || !activePdf) return null;
  if (pageTextCache.has(pageNumber)) return pageTextCache.get(pageNumber);
  if (pageTextRequests.has(pageNumber)) return pageTextRequests.get(pageNumber);

  const request = activePdf
    .getPage(pageNumber)
    .then(async (page) => {
      const content = await page.getTextContent();
      return { content, viewport: page.getViewport({ scale: 1 }) };
    })
    .then(({ content, viewport }) => {
      if (generation !== loadGeneration) return null;
      const text = content.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      const stats = analyzeText(text);
      const segments = segmentsFromPdfTextContent({
        pageIndex: pageNumber - 1,
        textContent: content,
        source: "native-text",
        viewport,
      });
      const textLayoutOptions = {
        pageWidth: viewport.width,
        pageDimensions: {
          width: viewport.width,
          height: viewport.height,
          coordinateSystem: "top-down",
        },
        coordinateSystem: "top-down",
        minChars: 120,
        maxChars: 420,
      };
      const chunks = segmentsToReadableChunks(segments, textLayoutOptions);
      const paragraphs = segmentsToParagraphPassages(segments, textLayoutOptions);
      const pointSentences = createPointSentenceTargets(segments, textLayoutOptions);
      pageTextCache.set(pageNumber, stats);
      pageReadableChunkCache.set(pageNumber, chunks);
      pageParagraphPassageCache.set(pageNumber, paragraphs);
      pagePointSentenceCache.set(pageNumber, pointSentences);
      bumpParagraphPassageRevision(pageNumber, "native");
      nativeTextAssessments.set(pageNumber, assessTextQuality({
        segments,
        chunks,
        source: "native-text",
      }));
      reconcilePageTextSource(pageNumber);
      syncPointReadSurfaces();
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
  let currentPageUnits = 0;
  let currentPageHeight = 0;

  for (const pageNumber of nearbyPageNumbers(activeReadingPage)) {
    const stats = bestPageTextStats(pageNumber);
    const shell = pageShells[pageNumber - 1];
    if (!stats || !shell) continue;
    const shellHeight = shell.offsetHeight || Number(shell.dataset.height) || 0;
    const pageUnits = stats.cjkCharacters + stats.numericUnits + stats.englishWords;
    cjkCharacters += stats.cjkCharacters;
    numericUnits += stats.numericUnits;
    englishWords += stats.englishWords;
    measuredHeight += shellHeight;
    if (pageNumber === activeReadingPage) {
      currentPageUnits = pageUnits;
      currentPageHeight = shellHeight;
    }
  }

  if (!measuredHeight) return null;

  const mode = readingMetricMode(cjkCharacters, englishWords);
  const cjkRate = ["cjk", "both"].includes(mode)
    ? unitsPerMinute(cjkCharacters + numericUnits, measuredHeight, speed)
    : 0;
  const englishRate = unitsPerMinute(englishWords, measuredHeight, speed);
  const windowDensity = (cjkCharacters + numericUnits + englishWords) / measuredHeight;
  const currentDensity = currentPageHeight > 0 ? currentPageUnits / currentPageHeight : 0;
  const densityRatio = windowDensity > 0 && currentDensity > 0
    ? currentDensity / windowDensity
    : null;
  const remainingPixels = Math.max(
    0,
    elements.viewport.scrollHeight - elements.viewport.clientHeight - elements.viewport.scrollTop,
  );

  return createRhythmSnapshot({
    mode,
    cjkRate,
    englishRate,
    densityRatio,
    remainingPixels,
    pixelsPerSecond: speed,
    tier: speedTier(speed),
    source: textSourceStateForPage(activeReadingPage).selectedSource,
  });
}

function replayClass(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function formatRateRange(range) {
  if (!range || (!range.min && !range.max)) return "—";
  if (range.min === range.max) return `≈${numberFormat.format(range.min)}`;
  return `≈${numberFormat.format(range.min)}–${numberFormat.format(range.max)}`;
}

function formatFlowTime(range) {
  if (!range) return "";
  if (range.minMinutes === range.maxMinutes) {
    return `以当前速度，估算还需阅读约 ${range.minMinutes} 分钟`;
  }
  return `以当前速度，估算还需阅读约 ${range.minMinutes}–${range.maxMinutes} 分钟`;
}

function renderSpeedEstimate(origin = "density") {
  const estimate = computeReadingEstimate();
  const signature = estimate
    ? `${estimate.mode}:${estimate.cjkRange.min}:${estimate.cjkRange.max}:${estimate.englishRange.min}:${estimate.englishRange.max}:${estimate.density.key}:${estimate.remainingFlowTime?.minMinutes ?? 0}:${estimate.remainingFlowTime?.maxMinutes ?? 0}`
    : "waiting";
  if (signature === lastEstimateSignature) return;
  lastEstimateSignature = signature;

  elements.estimateWaiting.hidden = Boolean(estimate);
  elements.cjkEstimate.hidden = !estimate || !["cjk", "both"].includes(estimate.mode);
  elements.englishEstimate.hidden =
    !estimate || !["english", "both"].includes(estimate.mode);
  elements.estimateDivider.hidden = !estimate || estimate.mode !== "both";
  elements.rhythmInsight.hidden = !estimate || estimate.mode === "empty";

  if (!estimate) {
    elements.estimateWaiting.textContent = "正在轻轻估算…";
    elements.rhythmInsight.hidden = true;
    elements.topReadingTime.hidden = true;
    elements.topReadingTime.textContent = "";
  } else if (estimate.mode === "empty") {
    elements.estimateWaiting.textContent = "这一带还没有可估算的文字";
    elements.estimateWaiting.hidden = false;
    elements.rhythmInsight.hidden = true;
    elements.topReadingTime.hidden = true;
    elements.topReadingTime.textContent = "";
  } else {
    elements.cjkRate.textContent = formatRateRange(estimate.cjkRange);
    elements.englishRate.textContent = formatRateRange(estimate.englishRange);
    elements.densityHint.textContent = estimate.density.hint;
    const flowText = formatFlowTime(estimate.remainingFlowTime);
    elements.topReadingTime.hidden = !flowText;
    elements.topReadingTime.textContent = flowText;
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
  enforceTtsAvailability("speed-tier-unavailable");
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
        pageReadableChunkCache.set(pageNumber, []);
        pageParagraphPassageCache.set(pageNumber, []);
        pagePointSentenceCache.set(pageNumber, []);
        bumpParagraphPassageRevision(pageNumber, "native");
        nativeTextAssessments.set(pageNumber, assessTextQuality({
          segments: [],
          chunks: [],
          source: "native-text",
        }));
        reconcilePageTextSource(pageNumber);
      }
    }
    if (
      request === textWindowRequest &&
      generation === loadGeneration &&
      activeReadingPage === centerPage
    ) {
      renderSpeedEstimate("density");
      updateTtsSchedulerDiagnostics(centerPage);
      publishDiagnostics();
    }
  }
  if (
    request === textWindowRequest &&
    generation === loadGeneration &&
    activeReadingPage === centerPage
  ) {
    reconcilePageTextSource(centerPage, { allowAutoOcr: true });
  }
}

function cancelOcrWorkload(reason = "ocr-cancelled") {
  if (!ocrWorkloadActive && !ocrAbortController && ocrTaskByPage.size === 0) {
    return;
  }
  ocrScanRequest += 1;
  ocrTaskScheduler.cancel(reason);
  const hadActiveScan = Boolean(
    ocrAbortController &&
    !ocrAbortController.signal.aborted
  );
  ocrAbortController?.abort();
  ocrAbortController = null;
  if (hadActiveScan) void ocrProvider?.cancel?.();
  ocrProgressPosition = null;
  ocrWorkloadActive = false;
  for (const [pageNumber] of ocrTaskByPage) {
    ocrTaskByPage.delete(pageNumber);
    reconcilePageTextSource(pageNumber);
  }
  updateRenderBudget();
  updateOcrControls();
}

function handleReadingPageChange(pageNumber) {
  if (!pageNumber) return;
  const pageChanged = pageNumber !== activeReadingPage;
  if (pageChanged) {
    const previousPage = activeReadingPage;
    const keepWindingStreamContext = shouldPreserveParagraphFlowOnPageChange({
      enabled: ttsController.isEnabled(),
      tierKey: currentTtsPolicy().tierKey,
      previousPage,
      nextPage: pageNumber,
      direction: scrollDirection,
      jumped: ttsParagraphJumpPending,
    });
    const keepContinuousSpeech = shouldPreserveContinuousSpeechOnPageChange({
      enabled: ttsController.isEnabled(),
      tierKey: currentTtsPolicy().tierKey,
      previousPage,
      nextPage: pageNumber,
      direction: scrollDirection,
      jumped: ttsParagraphJumpPending,
    });
    if (previousPage && !keepWindingStreamContext && !keepContinuousSpeech) {
      ttsParagraphJumpPending = true;
      cancelSpeechSession("page-changed");
    }
    pageShells[activeReadingPage - 1]?.classList.remove("is-active");
    activeReadingPage = pageNumber;
    pageShells[activeReadingPage - 1]?.classList.add("is-active");
    cancelOcrWorkload("page-changed");
    lastEstimateSignature = "";
    renderSpeedEstimate("density");
    void refreshNearbyTextStats(pageNumber, loadGeneration).finally(updateOcrControls);
    updateOcrControls();
    syncPointReadSurfaces();
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

function cancelReadingReflow(reason = "user-intervention") {
  const cancelled = readingReflow.cancel(reason, { now: performance.now() });
  elements.speedExperience.dataset.motion = "idle";
  elements.speedPixels.textContent = String(Math.round(speed));
  if (elements.traceStatus?.textContent.includes("回到书流")) {
    elements.traceStatus.hidden = true;
    elements.traceStatus.textContent = "";
  }
  return cancelled;
}

function beginReadingReflow({ reason = "resume", interruptionMs = 0 } = {}) {
  const snapshot = readingReflow.start({
    currentSpeed: speed,
    interruptionMs,
    reason,
    now: performance.now(),
  });
  setPlaying(true);
  if (snapshot.active) {
    elements.speedExperience.dataset.motion = "reflow";
    if (elements.traceStatus) {
      elements.traceStatus.hidden = false;
      elements.traceStatus.textContent = snapshot.mode === "long"
        ? "正在缓慢回到书流"
        : "正在回到书流";
    }
  } else {
    elements.speedExperience.dataset.motion = "idle";
  }
  return snapshot;
}

function setPlaying(next, { cancelSpeech = true } = {}) {
  if (next && traceCapture.snapshot().scrollHold) return;
  if (!next) {
    if (playing || readingReflow.snapshot().active) pausedAt = Date.now();
    cancelReadingReflow("paused");
  }
  playing = next;
  if (!playing && cancelSpeech) {
    cancelSpeechSession("paused");
    renderTtsReadingLine(activeReadingPage || currentPageNumber(), { phase: "tracking" });
  }
  elements.toggleIcon.textContent = playing ? "Ⅱ" : "▶";
  elements.toggleText.textContent = playing ? "暂停" : "继续";
  elements.toggle.setAttribute("aria-pressed", String(!playing));
  publishDiagnostics();
}

function clearFirstPageMessageTimer() {
  window.clearTimeout(firstPageMessageTimer);
  firstPageMessageTimer = 0;
}

function showError(error) {
  clearFirstPageMessageTimer();
  clearTextSession();
  activeTraceDocument = null;
  traceCapture.setDocument(null);
  traceBook.setDocument(null);
  readyToMove = false;
  setPlaying(false, { cancelSpeech: false });
  elements.toggle.disabled = true;
  elements.loading.hidden = true;
  elements.ocrDock.hidden = true;
  elements.errorText.textContent =
    error instanceof Error ? error.message : String(error);
  elements.errorPanel.hidden = false;
}

function showEmptyState({ clearSession = true } = {}) {
  clearFirstPageMessageTimer();
  if (clearSession) clearTextSession();
  activeTraceDocument = null;
  traceCapture.setDocument(null);
  traceBook.setDocument(null);
  readyToMove = false;
  activeDocumentRecord = null;
  activeFileMeta = null;
  setPlaying(false, { cancelSpeech: false });
  elements.pages.replaceChildren();
  elements.emptyState.hidden = false;
  elements.loading.hidden = true;
  elements.finish.hidden = true;
  elements.errorPanel.hidden = true;
  elements.controls.hidden = true;
  elements.ocrDock.hidden = true;
  elements.toggle.disabled = true;
  elements.documentName.textContent = "让 PDF 安静地流过眼前";
  elements.homeButton.hidden = true;
  elements.fileButton.textContent = "选择 PDF";
  elements.pageStatus.textContent = "请选择一份 PDF";
  elements.progressBar.style.width = "0%";
  elements.topReadingTime.hidden = true;
  elements.topReadingTime.textContent = "";
  document.title = "夜晚的书斋";
  renderHomeEcho();
  syncTtsControlVisibility();
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
        if (previousCanvas) previousCanvas.replaceWith(canvas);
        else shell.prepend(canvas);
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
    cacheBudgetForDeviceMemory(deviceMemoryGb, {
      ocrEnabled: ocrWorkloadActive,
    }),
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

async function returnToHome() {
  if (returningHome) return;
  returningHome = true;
  try {
    window.clearTimeout(persistTimer);
    persistTimer = 0;
    if (activeDocumentRecord) persistReadingRecord();
    ++loadGeneration;
    pendingSourceAbortController?.abort?.();
    pendingSourceAbortController = null;
    clearFirstPageMessageTimer();
    clearHomeBookTakingState();
    traceCapture.reset("returned-to-shelf");
    traceBook.setDocument(null);
    cancelReadingReflow("returned-to-shelf");
    elements.homeButton.hidden = true;
    clearTextSession();
    await disposeActiveDocument();
    pageCount = 0;
    pageShells = [];
    pageLayout = [];
    pageTops = [];
    elements.viewport.scrollTop = 0;
    showEmptyState({ clearSession: false });
    window.requestAnimationFrame(() => elements.recentBooks.focus({ preventScroll: true }));
  } finally {
    returningHome = false;
  }
}

async function openPdf(sourceOrFactory, displayName, { fileMeta = null } = {}) {
  window.clearTimeout(persistTimer);
  persistTimer = 0;
  if (activeDocumentRecord) persistReadingRecord();
  const generation = ++loadGeneration;
  pendingSourceAbortController?.abort();
  const sourceController = new AbortController();
  pendingSourceAbortController = sourceController;
  clearFirstPageMessageTimer();
  clearTextSession();
  activeTraceDocument = null;
  traceCapture.reset("document-changing");
  traceBook.setDocument(null);
  cancelReadingReflow("document-changing");
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
  activeFileMeta = fileMeta ?? {
    fileName: displayName,
    fileSize: null,
    lastModified: 0,
  };
  activeDocumentRecord = activateDocumentRecord(activeFileMeta);
  elements.documentName.textContent = displayName;
  elements.pageStatus.textContent = "准备中";
  elements.progressBar.style.width = "0%";
  elements.topReadingTime.hidden = true;
  elements.topReadingTime.textContent = "";
  elements.controls.hidden = true;
  elements.ocrDock.hidden = true;
  elements.ocrStatus.hidden = true;
  elements.ocrStatus.textContent = "";
  elements.homeButton.hidden = false;
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
  await registerTraceDocument(pdf, displayName);
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
  maybeRestoreReadingPosition();

  renderScheduler = new RenderScheduler({
    concurrency: 2,
    budget: cacheBudgetForDeviceMemory(deviceMemoryGb, {
      ocrEnabled: ocrWorkloadActive,
    }),
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
  beginReadingReflow({ reason: "new-document" });
}

function currentPageNumber() {
  if (!pageTops.length) return 0;
  const readingLine = elements.viewport.scrollTop + elements.viewport.clientHeight * 0.38;
  return findPageNumberAtOffset(pageTops, readingLine);
}

function normalizedReadingLineForPage(pageNumber) {
  const index = pageNumber - 1;
  const pageTop = pageTops[index];
  const pageHeight = pageLayout[index]?.height || pageShells[index]?.offsetHeight || 0;
  if (!Number.isFinite(pageTop) || pageHeight <= 0) return 0.38;
  const readingLine = elements.viewport.scrollTop + elements.viewport.clientHeight * 0.38;
  return Math.max(0, Math.min(1, (readingLine - pageTop) / pageHeight));
}

function scheduleContinuousSpeechOcrAhead(
  pageNumber,
  policy = currentTtsPolicy(),
) {
  const nextPage = pageNumber + 1;
  const targetPage = continuousOcrAheadPage({
    enabled: ttsController.isEnabled(),
    tierKey: policy?.tierKey,
    isPlaying: playing,
    workloadActive: ocrWorkloadActive,
    currentPage: pageNumber,
    pageCount,
    nextPageNativeKnown: nativeTextAssessments.has(nextPage),
    nextPageTtsReady: textSourceStateForPage(nextPage).ttsReady,
    nextPageOcrKnown: (
      ocrTextAssessments.has(nextPage) ||
      ocrTaskByPage.has(nextPage)
    ),
    nextPageFailed: ocrFailureByPage.has(nextPage),
  });
  if (!targetPage) return false;
  return scheduleNearbyOcr(targetPage, { priorityPage: targetPage });
}

function updateTtsSchedulerDiagnostics(pageNumber = activeReadingPage) {
  if (!pageNumber || !readyToMove) return;
  const controllerSnapshot = ttsController.snapshot();
  scheduleContinuousSpeechOcrAhead(pageNumber, controllerSnapshot.policy);
  const warmupRequest = currentTtsWarmupRequest(pageNumber);
  if (warmupRequest && !isTtsWarmupReady(warmupRequest)) {
    ensureTtsRuntimeActive("page-language-ready");
    refreshTtsRuntimeStatus();
    publishDiagnostics();
    return;
  }
  const audioSnapshot = ttsAudioPlayer.snapshot();
  const schedulerSnapshot = ttsScheduler.snapshot();
  const paragraphFlowActive = controllerSnapshot.policy.autoRead === "paragraph-lead";
  if (ttsWarmupStatus === "loading" && !controllerSnapshot.manualArmedAction) {
    refreshTtsRuntimeStatus();
    publishDiagnostics();
    return;
  }
  if (
    (ttsUtteranceLocked || audioSnapshot.active || schedulerSnapshot.active) &&
    !controllerSnapshot.manualArmedAction &&
    !paragraphFlowActive
  ) {
    refreshTtsRuntimeStatus();
    publishDiagnostics();
    return;
  }
  const clock = createReadingClockSnapshot({
    isPlaying: playing,
    speedPxPerSecond: speed,
    scrollTop: elements.viewport.scrollTop,
    viewportHeight: elements.viewport.clientHeight,
    scrollHeight: elements.viewport.scrollHeight,
    currentPageIndex: pageNumber - 1,
  });
  const paragraphJumped = paragraphFlowActive && ttsParagraphJumpPending;
  ttsParagraphJumpPending = false;
  void ttsController.tick({
    isPlaying: clock.isPlaying,
    chunks: readableChunksForPage(pageNumber),
    prefetchChunks: continuousSpeechPrefetchChunks(
      pageNumber,
      controllerSnapshot.policy,
    ),
    normalizedReadingY: normalizedReadingLineForPage(pageNumber),
    pageHeightPx: (
      pageLayout[pageNumber - 1]?.height ||
      pageShells[pageNumber - 1]?.offsetHeight ||
      0
    ),
    scrollPxPerSecond: speed,
    pageNumber,
    documentGeneration: loadGeneration,
    paragraphs: paragraphFlowActive ? paragraphWindowForPage(pageNumber) : [],
    readingPosition: clock.readingLineY,
    paragraphContextKey: paragraphFlowActive ? paragraphFlowContextKey(pageNumber) : null,
    jumped: paragraphJumped,
  }).finally(() => {
    const nextScheduler = ttsScheduler.snapshot();
    const nextAudio = ttsAudioPlayer.snapshot();
    if (
      ["failed", "cancelled", "paused", "simulated", "late-skip", "visual-skip"].includes(nextScheduler.status) &&
      !nextAudio.active
    ) {
      ttsUtteranceLocked = false;
      if (["late-skip", "visual-skip"].includes(nextScheduler.status)) clearTtsFocus();
    }
    refreshTtsRuntimeStatus();
    publishDiagnostics();
  });
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
  syncPointReadSurfaces();
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
  const largeReadingJump = isLargeParagraphReadingJump({
    scrollDelta,
    viewportHeight: elements.viewport.clientHeight,
  });
  if (
    largeReadingJump &&
    ttsController.isEnabled()
  ) {
    ttsParagraphJumpPending = true;
    if (page === activeReadingPage) cancelSpeechSession("reading-jumped");
  }
  elements.pageStatus.textContent = page ? `${page} / ${pageCount} 页` : "准备中";
  handleReadingPageChange(page);
  if (!ttsUtteranceLocked || !document.querySelector(".tts-focus")) {
    renderTtsReadingLine(page, { phase: ttsUtteranceLocked ? "speaking" : "tracking" });
  }
  updateTtsSchedulerDiagnostics(page);
  schedulePersistReadingRecord();
}

function animate(timestamp) {
  if (!lastFrame) lastFrame = timestamp;
  const elapsed = Math.min(64, timestamp - lastFrame);
  lastFrame = timestamp;

  let automaticSpeed = speed;
  const reflow = readingReflow.sample(timestamp);
  if (reflow) {
    automaticSpeed = reflow.speed;
    elements.speedPixels.textContent = String(Math.round(automaticSpeed));
    if (reflow.done) {
      speed = reflow.targetSpeed;
      automaticSpeed = speed;
      elements.speed.value = String(speed);
      elements.speedExperience.dataset.motion = "idle";
      updateSpeedPresentation("initial");
      schedulePersistReadingRecord();
      if (elements.traceStatus?.textContent.includes("回到书流")) {
        elements.traceStatus.hidden = true;
        elements.traceStatus.textContent = "";
      }
    }
  }
  const desiredSpeed = (
    readyToMove &&
    playing &&
    !pointReadScrollHold &&
    !traceCapture.snapshot().scrollHold &&
    !document.hidden
  ) ? automaticSpeed : 0;
  if (desiredSpeed > 0) lastFlowSpeed = desiredSpeed;
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
  if (playing) {
    setPlaying(false);
  } else {
    beginReadingReflow({
      reason: "resume",
      interruptionMs: Math.max(0, Date.now() - pausedAt),
    });
  }
});

elements.speed.addEventListener("input", () => {
  cancelReadingReflow("speed-changed");
  interruptPointReadForUser("speed-changed");
  const previousSpeed = speed;
  speed = Number(elements.speed.value);
  const delta = speed - previousSpeed;
  updateSpeedPresentation("manual");
  animateManualSpeedChange(delta);
  queueSpeedParticle(delta);
  queueSpeedCue(previousSpeed, speed);
  schedulePersistReadingRecord();
});

elements.ttsModeButton?.addEventListener("click", () => {
  toggleTtsEnabled();
});

elements.ttsPointReadButton?.addEventListener("click", () => {
  toggleTtsEnabled();
});

elements.ttsManualReadButton?.addEventListener("click", () => {
  void requestLineSpeech();
});

function cacheOcrPageText(
  pageNumber,
  result,
  generation = loadGeneration,
  request = null,
) {
  const text = typeof result === "string" ? result : result?.text;
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
  let segments = [];
  let chunks = [];
  let paragraphs = [];
  let pointSentences = [];
  if (typeof result === "object" && result !== null) {
    segments = segmentsFromOcrResult({
      pageIndex: pageNumber - 1,
      result,
      source: "ocr",
    });
    const textLayoutOptions = {
      pageWidth: result.pageDimensions?.width,
      pageDimensions: result.pageDimensions
        ? { ...result.pageDimensions, coordinateSystem: "top-down" }
        : null,
      coordinateSystem: "top-down",
      minChars: 24,
      maxChars: 180,
    };
    chunks = segmentsToReadableChunks(segments, textLayoutOptions);
    paragraphs = segmentsToParagraphPassages(segments, textLayoutOptions);
    const pointSegments = segmentsFromOcrResult({
      pageIndex: pageNumber - 1,
      result,
      source: "ocr",
      // CJK OCR word boxes are frequently fragmented or returned in an
      // unstable order. Tesseract's line boxes preserve a much more coherent
      // reading stream; Latin scans retain word boxes for precise clicking.
      prefer: pointSegmentPreferenceForOcrLanguageSet(result.languageSet),
    });
    pointSentences = createPointSentenceTargets(
      pointSegments.length ? pointSegments : segments,
      textLayoutOptions,
    );
  }
  ocrReadableChunkCache.set(pageNumber, chunks);
  ocrParagraphPassageCache.set(pageNumber, paragraphs);
  ocrPointSentenceCache.set(pageNumber, pointSentences);
  bumpParagraphPassageRevision(pageNumber, "ocr");
  ocrTextAssessments.set(pageNumber, assessTextQuality({
    segments,
    chunks,
    source: "ocr",
    languageSet: result?.languageSet ?? "",
  }));
  ocrFailureByPage.delete(pageNumber);
  if (
    request === null ||
    ocrTaskByPage.get(pageNumber)?.request === request
  ) {
    ocrTaskByPage.delete(pageNumber);
  }
  reconcilePageTextSource(pageNumber);
  syncPointReadSurfaces();
  if (nearbyPageNumbers(activeReadingPage).includes(pageNumber)) {
    renderSpeedEstimate("density");
    publishDiagnostics();
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
  const sourceState = textSourceStateForPage(activeReadingPage);
  const buttonTextByState = {
    "checking-native": "正在检查文字…",
    "native-ready": "扫描页增强",
    "ocr-needed": "扫描附近页",
    "ocr-scheduled": "扫描已排队…",
    "ocr-running": "正在扫描附近页…",
    "ocr-ready": "重新扫描本页",
    "ocr-poor": "重试本页扫描",
    "ocr-failed": "重试本页扫描",
    "ocr-suppressed": "扫描本页",
  };
  elements.ocrButton.disabled = (
    !ocrProvider ||
    !readyToMove ||
    !activePdf ||
    ocrWorkloadActive ||
    sourceState.state === "checking-native"
  );
  elements.ocrButton.textContent = ocrWorkloadActive
    ? sourceState.state === "ocr-scheduled"
      ? "扫描已排队…"
      : "正在扫描附近页…"
    : buttonTextByState[sourceState.state] ?? "扫描附近页";
  elements.ocrButton.removeAttribute("aria-pressed");
  elements.ocrButton.setAttribute("aria-busy", String(ocrWorkloadActive));
  elements.ocrDock.dataset.active = String(ocrWorkloadActive);
  elements.ocrDock.hidden = !ocrProvider || !activePdf || !readyToMove;
  syncTtsControlVisibility();
}

function describeOcrProgress(message) {
  if (!ocrWorkloadActive || !message) return;
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

async function runNearbyOcr(
  centerPage,
  generation,
  request,
  priorityPage = centerPage,
) {
  if (
    !ocrWorkloadActive ||
    !ocrProvider ||
    !activePdf ||
    request !== ocrScanRequest ||
    generation !== loadGeneration
  ) {
    return;
  }

  const orderedNearby = nearbyPageNumbers(centerPage);
  const pages = [
    ...(priorityPage ? [priorityPage] : []),
    ...orderedNearby,
  ].filter((pageNumber, index, list) => (
    Number.isInteger(pageNumber) &&
    pageNumber >= 1 &&
    pageNumber <= pageCount &&
    list.indexOf(pageNumber) === index &&
    ocrTaskByPage.get(pageNumber)?.request === request &&
    (
      nativeTextAssessments.get(pageNumber)?.state !== "ready" ||
      ocrTaskByPage.get(pageNumber)?.manualEnhancement === true
    )
  ));

  const controller = new AbortController();
  ocrAbortController = controller;
  elements.ocrStatus.hidden = false;
  let activeOcrPage = null;

  try {
    for (let index = 0; index < pages.length; index += 1) {
      if (
        controller.signal.aborted ||
        !ocrWorkloadActive ||
        request !== ocrScanRequest ||
        generation !== loadGeneration
      ) {
        break;
      }
      const pageNumber = pages[index];
      const pageTask = ocrTaskByPage.get(pageNumber);
      if (
        nativeTextAssessments.get(pageNumber)?.state === "ready" &&
        pageTask?.manualEnhancement !== true
      ) {
        ocrTaskByPage.delete(pageNumber);
        reconcilePageTextSource(pageNumber);
        continue;
      }
      activeOcrPage = pageNumber;
      ocrTaskByPage.set(pageNumber, {
        ...pageTask,
        request,
        status: "running",
      });
      reconcilePageTextSource(pageNumber);
      ocrProgressPosition = { index: index + 1, total: pages.length };
      elements.ocrStatus.textContent = pageNumber === priorityPage
        ? `正在扫描当前页 ${index + 1}/${pages.length}`
        : `正在扫描附近页 ${index + 1}/${pages.length}`;
      const result = await ocrProvider.recognizePage({
        pdf: activePdf,
        pageNumber,
        signal: controller.signal,
        documentLabel: activeFileMeta?.fileName ?? elements.documentName.textContent ?? "",
      });
      cacheOcrPageText(pageNumber, result, generation, request);
      activeOcrPage = null;
    }
    if (
      !controller.signal.aborted &&
      ocrWorkloadActive &&
      request === ocrScanRequest &&
      generation === loadGeneration
    ) {
      elements.ocrStatus.textContent = "附近扫描已用于估算";
    }
  } catch (error) {
    if (
      error?.name !== "AbortError" &&
      ocrWorkloadActive &&
      request === ocrScanRequest &&
      generation === loadGeneration
    ) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ocrLastError = errorMessage;
      if (activeOcrPage) {
        ocrFailureByPage.set(activeOcrPage, errorMessage);
        ocrTaskByPage.delete(activeOcrPage);
        reconcilePageTextSource(activeOcrPage);
      }
      elements.ocrStatus.textContent = "扫描未完成，可以重试";
      updateOcrControls();
    }
  } finally {
    if (ocrAbortController === controller) {
      ocrAbortController = null;
    }
    for (const [pageNumber, task] of ocrTaskByPage) {
      if (task.request !== request) continue;
      ocrTaskByPage.delete(pageNumber);
      reconcilePageTextSource(pageNumber);
    }
    if (request === ocrScanRequest) {
      ocrWorkloadActive = false;
      updateRenderBudget();
      updateOcrControls();
      updateCurrentTextSourceStatus();
    }
    ocrProgressPosition = null;
    publishDiagnostics();
  }
}

function scheduleNearbyOcr(
  centerPage = activeReadingPage,
  { priorityPage = 0, manualRetry = false } = {},
) {
  if (!ocrProvider || !activePdf || !centerPage) return false;
  const requestedPriorityPage = priorityPage || centerPage;
  const pages = [
    requestedPriorityPage,
    ...nearbyPageNumbers(centerPage),
  ].filter((pageNumber, index, list) => {
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > pageCount ||
      list.indexOf(pageNumber) !== index ||
      !nativeTextAssessments.has(pageNumber)
    ) {
      return false;
    }
    const isManualPriority = (
      manualRetry &&
      pageNumber === requestedPriorityPage
    );
    if (
      nativeTextAssessments.get(pageNumber)?.state === "ready" &&
      !isManualPriority
    ) {
      return false;
    }
    if (manualRetry) {
      return (
        isManualPriority ||
        !ocrTextAssessments.has(pageNumber) ||
        ocrTextAssessments.get(pageNumber)?.state !== "ready" ||
        ocrFailureByPage.has(pageNumber)
      );
    }
    return (
      !ocrTextAssessments.has(pageNumber) &&
      !ocrFailureByPage.has(pageNumber)
    );
  });
  if (!pages.length) {
    updateCurrentTextSourceStatus();
    updateOcrControls();
    return false;
  }

  const generation = loadGeneration;
  const request = ocrScanRequest + 1;
  const scheduled = ocrTaskScheduler.schedule({
    centerPage,
    priorityPage: requestedPriorityPage,
    generation,
    request,
  });
  if (scheduled.reused) return false;

  for (const [pageNumber] of ocrTaskByPage) {
    ocrTaskByPage.delete(pageNumber);
    reconcilePageTextSource(pageNumber);
  }
  if (manualRetry) {
    for (const pageNumber of pages) {
      ocrTextCache.delete(pageNumber);
      ocrReadableChunkCache.delete(pageNumber);
      if (ocrParagraphPassageCache.delete(pageNumber)) {
        bumpParagraphPassageRevision(pageNumber, "ocr");
      }
      ocrTextAssessments.delete(pageNumber);
      ocrFailureByPage.delete(pageNumber);
    }
  }
  ocrScanRequest = request;
  ocrLastError = null;
  ocrWorkloadActive = true;
  for (const pageNumber of pages) {
    ocrTaskByPage.set(pageNumber, {
      request,
      status: "scheduled",
      manualEnhancement: (
        manualRetry &&
        pageNumber === requestedPriorityPage &&
        nativeTextAssessments.get(pageNumber)?.state === "ready"
      ),
    });
    reconcilePageTextSource(pageNumber);
  }
  updateOcrControls();
  updateRenderBudget();
  const hasActiveScan = Boolean(
    ocrAbortController &&
    !ocrAbortController.signal.aborted
  );
  ocrAbortController?.abort();
  if (hasActiveScan) void ocrProvider.cancel?.();
  elements.ocrStatus.hidden = false;
  elements.ocrStatus.textContent = "正在准备本地扫描模型";
  publishDiagnostics();
  return true;
}

window.pdfFlowReaderOcr = Object.freeze({
  registerProvider: registerOcrProvider,
  cachePageText: cacheOcrPageText,
  getContext: () => ({
    generation: loadGeneration,
    pageNumber: activeReadingPage,
    nearbyPages: nearbyPageNumbers(activeReadingPage),
    pdf: activePdf,
    workloadActive: ocrWorkloadActive,
    state: textSourceStateForPage(activeReadingPage),
    nativeAssessment: nativeTextAssessments.get(activeReadingPage) ?? null,
    ocrAssessment: ocrTextAssessments.get(activeReadingPage) ?? null,
  }),
});

elements.ocrButton.addEventListener("click", () => {
  scheduleNearbyOcr(activeReadingPage, {
    priorityPage: activeReadingPage,
    manualRetry: true,
  });
});

elements.ttsDiagnosticsClose?.addEventListener("click", () => toggleTtsDiagnosticsPanel(false));
elements.ttsDiagnosticsSelfTest?.addEventListener("click", () => {
  elements.ttsDiagnosticsOutput.textContent = "正在运行本地语音自检…";
  void runTtsSelfTest();
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

  const fileMeta = createFileMetaFromFile(file);
  const fileFingerprint = createDocumentFingerprint(fileMeta);
  if (pendingResumeRecord && pendingResumeRecord.fingerprint !== fileFingerprint) {
    elements.documentName.textContent = "所选文件与阅读回声不同，将作为新的 PDF 打开";
  }
  try {
    await openPdf(
      (signal) => createFilePdfSource(file, {
        rangeChunkSize: 256 * 1024,
        signal,
      }),
      file.name,
      { fileMeta },
    );
  } catch (error) {
    await disposeActiveDocument();
    showError(error);
  } finally {
    pendingResumeRecord = null;
    elements.filePicker.value = "";
    clearHomeBookTakingState();
  }
}

elements.filePicker.addEventListener("change", () => {
  void openLocalFile(elements.filePicker.files?.[0]);
});

elements.homeButton.addEventListener("click", () => {
  void returnToHome();
});

elements.filePicker.addEventListener("cancel", () => {
  pendingResumeRecord = null;
  clearHomeBookTakingState();
});

elements.recentBooks.addEventListener("click", (event) => {
  const card = event.target instanceof Element
    ? event.target.closest(".recent-book-card")
    : null;
  if (!(card instanceof HTMLButtonElement)) return;
  const index = Number(card.dataset.bookIndex);
  if (!Number.isInteger(index)) return;
  if (index === homeBookIndex) {
    takeSelectedHomeBook();
    return;
  }
  selectHomeBook(index, { focus: true });
});

elements.recentBooks.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", "Space"].includes(event.code)) {
    return;
  }
  event.stopPropagation();
  if (event.code === "ArrowLeft" || event.code === "ArrowUp") {
    event.preventDefault();
    moveHomeBook(-1, { focus: true });
    return;
  }
  if (event.code === "ArrowRight" || event.code === "ArrowDown") {
    event.preventDefault();
    moveHomeBook(1, { focus: true });
    return;
  }
  if (event.code === "Home") {
    event.preventDefault();
    selectHomeBook(0, { focus: true });
    return;
  }
  if (event.code === "End") {
    event.preventDefault();
    selectHomeBook(homeBookItems.length - 1, { focus: true });
    return;
  }
  if (event.code === "Enter" || event.code === "Space") {
    event.preventDefault();
    takeSelectedHomeBook();
  }
});

elements.recentBooks.addEventListener("wheel", (event) => {
  if (homeBookItems.length <= 1 || homeBookWheelLocked) return;
  const axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (Math.abs(axis) < 8) return;
  event.preventDefault();
  homeBookWheelLocked = true;
  moveHomeBook(axis > 0 ? 1 : -1, { focus: true });
  globalThis.setTimeout(() => {
    homeBookWheelLocked = false;
  }, reducedMotion.matches ? 0 : 180);
}, { passive: false });

elements.bookPrev.addEventListener("click", () => moveHomeBook(-1, { focus: true }));
elements.bookNext.addEventListener("click", () => moveHomeBook(1, { focus: true }));
elements.takeBook.addEventListener("click", takeSelectedHomeBook);
elements.openNewBook.addEventListener("click", () => {
  const index = homeBookItems.findIndex((item) => item.type === "new");
  if (index < 0) return;
  selectHomeBook(index);
  globalThis.requestAnimationFrame(takeSelectedHomeBook);
});

elements.clearRecords.addEventListener("click", () => {
  const confirmed = window.confirm("清除本机保存的最近阅读、位置和阅读回声？PDF 文件不会被删除。");
  if (!confirmed) return;
  saveLocalState(clearLocalState());
  activeDocumentRecord = null;
  activeFileMeta = null;
  homeBookSelectedId = null;
  renderHomeEcho();
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
  beginReadingReflow({ reason: "new-document" });
});

elements.viewport.addEventListener("scroll", () => updateReadingStatus(true), {
  passive: true,
});

elements.viewport.addEventListener("wheel", () => {
  cancelReadingReflow("user-scroll");
  interruptPointReadForUser("user-scroll");
}, { passive: true });

elements.viewport.addEventListener("touchstart", () => {
  cancelReadingReflow("touch-scroll");
  interruptPointReadForUser("touch-scroll");
}, { passive: true });

elements.viewport.addEventListener("pointerdown", (event) => {
  if (event.target === elements.viewport) {
    cancelReadingReflow("scrollbar-drag");
    interruptPointReadForUser("scrollbar-drag");
  }
}, { capture: true });

elements.pages.addEventListener("pointermove", (event) => {
  movePointReadGesture(event);
  updatePointReadHover(event);
}, { passive: true });

elements.pages.addEventListener("pointerdown", beginPointReadGesture);
elements.pages.addEventListener("pointerup", finishPointReadGesture);
elements.pages.addEventListener("pointercancel", () => {
  pointReadGesture = null;
});

elements.pages.addEventListener("pointerleave", () => {
  if (!pointReadIsActive()) clearPointReadHighlight();
});

document.addEventListener("selectionchange", () => {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !pointReadIsActive()) return;
  const anchor = selection.anchorNode instanceof Element
    ? selection.anchorNode
    : selection.anchorNode?.parentElement;
  if (anchor?.closest?.(".point-read-text-layer")) {
    interruptPointReadForUser("text-selection");
  }
});

elements.viewport.addEventListener("click", (event) => {
  if (isBackgroundClick(event)) togglePatternMode();
});

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(resizeRenderedPages, 160);
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if ([
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
  ].includes(event.code)) {
    cancelReadingReflow("keyboard-scroll");
    interruptPointReadForUser("keyboard-scroll");
  }
  if (event.code === "Space") {
    event.preventDefault();
    elements.toggle.click();
    return;
  }
  if (event.code === "KeyH") {
    event.preventDefault();
    toggleTtsEnabled();
    return;
  }
  if (event.code === "KeyR") {
    event.preventDefault();
    void requestLineSpeech();
    return;
  }
  if (event.code === "KeyD") {
    event.preventDefault();
    toggleTtsDiagnosticsPanel();
    return;
  }
  if (event.code === "Escape") {
    cancelSpeechSession("manual-stop");
    return;
  }
});

window.addEventListener("beforeunload", () => {
  if (activeDocumentRecord) persistReadingRecord();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    cancelReadingReflow("document-hidden");
    const pointInterrupted = interruptPointReadForUser("document-hidden");
    wasPlayingBeforeHidden = pointInterrupted ? false : playing;
  } else if (
    wasPlayingBeforeHidden &&
    readyToMove &&
    !traceCapture.snapshot().scrollHold
  ) {
    beginReadingReflow({
      reason: "app-resume",
      interruptionMs: hiddenAt === null ? 0 : Math.max(0, Date.now() - hiddenAt),
    });
    hiddenAt = null;
  }
});

setInterval(() => {
  fetch("./heartbeat", { cache: "no-store" }).catch(() => {});
}, 30_000);

applyPatternMode();
updateSpeedPresentation("initial");
requestAnimationFrame(animate);
void initializeCredentialBridge();

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
      {
        fileMeta: {
          fileName: config.fileName,
          fileSize: config.fileSize,
          lastModified: config.lastModified ?? 0,
        },
      },
    );
  } else {
    showEmptyState();
  }
} catch (error) {
  await disposeActiveDocument();
  showError(error);
}
