import {
  emotionFromPadPoint,
  emotionMarkerPosition,
  moveEmotionCoordinate,
  nearbyEmotionWords,
  normalizeEmotionCoordinate,
} from "./emotion-coordinate.mjs";
import {
  normalizePointerToPage,
  prepareLassoPath,
  sampleLassoPoint,
  selectLassoText,
} from "./lasso-geometry.mjs";
import { renderLassoCrop } from "./trace-crop.mjs";
import {
  createTraceSessionState,
  transitionTraceSession,
} from "./trace-session.mjs";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function defaultTraceId() {
  if (globalThis.crypto?.randomUUID) return `trace-${crypto.randomUUID()}`;
  return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function requiredElement(value, name) {
  if (!value) throw new TypeError(`trace controller 缺少 ${name}。`);
  return value;
}

function pageNumberFromShell(shell) {
  const pageNumber = Number(shell?.dataset?.page);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 0;
}

function createLassoLayer(shell) {
  shell.querySelector(":scope > .trace-lasso-layer")?.remove();
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.classList.add("trace-lasso-layer");
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.classList.add("trace-lasso-path");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(path);
  shell.append(svg);
  shell.classList.add("is-trace-target");
  return { svg, path };
}

function pathData(points, close = false) {
  if (!points.length) return "";
  const commands = points.map((point, index) => (
    `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
  ));
  if (close && points.length >= 3) commands.push("Z");
  return commands.join(" ");
}

function setPointerCaptureSafely(target, pointerId) {
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic integration events do not own a native pointer capture.
  }
}

function releasePointerCaptureSafely(target, pointerId) {
  try {
    target.releasePointerCapture?.(pointerId);
  } catch {
    // The pointer may already be released or may be synthetic.
  }
}

export function createTraceCaptureController({
  elements,
  traceClient,
  getPageChunks = () => [],
  getPageCanvas = () => null,
  getSpeedContext = () => ({ speedTier: "long-day", speedPxPerSecond: 16 }),
  onPause = () => {},
  onCancelSpeech = () => {},
  onReturnToFlow = () => {},
  createId = defaultTraceId,
} = {}) {
  const button = requiredElement(elements?.button, "button");
  const status = requiredElement(elements?.status, "status");
  const panel = requiredElement(elements?.panel, "panel");
  const preview = requiredElement(elements?.preview, "preview");
  const summary = requiredElement(elements?.summary, "summary");
  const emotionPad = requiredElement(elements?.emotionPad, "emotionPad");
  const emotionMarker = requiredElement(elements?.emotionMarker, "emotionMarker");
  const emotionWords = requiredElement(elements?.emotionWords, "emotionWords");
  const returnButton = requiredElement(elements?.returnButton, "returnButton");
  const pages = requiredElement(elements?.pages, "pages");
  const viewport = requiredElement(elements?.viewport, "viewport");

  let session = createTraceSessionState();
  let documentRecord = null;
  let activeShell = null;
  let activePointerId = null;
  let lassoLayer = null;
  let latestTrace = null;
  let emotionCoordinate = null;
  let emotionMutationPending = 0;
  let previewUrl = null;
  let traceMutationQueue = Promise.resolve();

  const desktopAvailable = Boolean(traceClient?.available);

  function snapshot() {
    return Object.freeze({
      ...session,
      scrollHold: session.phase !== "idle",
      documentAvailable: Boolean(documentRecord),
      latestTraceId: latestTrace?.id ?? null,
    });
  }

  function setStatus(message = "", { visible = true } = {}) {
    status.textContent = message;
    status.hidden = !visible || !message;
  }

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.removeAttribute("src");
    preview.hidden = true;
  }

  function renderEmotion(coordinate = emotionCoordinate, { saving = false } = {}) {
    emotionCoordinate = normalizeEmotionCoordinate(coordinate);
    emotionPad.dataset.saving = String(Boolean(saving));
    const position = emotionMarkerPosition(emotionCoordinate);
    if (!position) {
      emotionMarker.hidden = true;
      emotionWords.textContent = "尚未落点";
      emotionPad.removeAttribute("aria-valuetext");
      return;
    }
    emotionMarker.hidden = false;
    emotionMarker.style.left = `${position.leftPercent}%`;
    emotionMarker.style.top = `${position.topPercent}%`;
    const words = nearbyEmotionWords(emotionCoordinate);
    emotionWords.textContent = words.join(" · ");
    emotionPad.setAttribute(
      "aria-valuetext",
      `效价 ${emotionCoordinate.valence.toFixed(2)}，唤醒 ${emotionCoordinate.arousal.toFixed(2)}；${words.join("、")}`,
    );
  }

  function updateTraceSummary() {
    if (!latestTrace) return;
    const page = latestTrace.pageIndex + 1;
    const crop = latestTrace.crop.state === "ready" ? "截图已保存" : "裁图待恢复";
    const emotion = latestTrace.emotion.state === "unplaced" ? "情绪待落点" : "情绪已落点";
    summary.textContent = `第 ${page} 页 · ${crop} · ${emotion}`;
  }

  function clearEmotion() {
    emotionCoordinate = null;
    emotionMutationPending = 0;
    renderEmotion(null);
  }

  function clearLassoLayer() {
    lassoLayer?.svg?.remove();
    lassoLayer = null;
    activeShell?.classList.remove("is-trace-target");
  }

  function syncUi() {
    const active = session.phase !== "idle";
    button.hidden = !desktopAvailable || !documentRecord;
    button.disabled = !desktopAvailable || !documentRecord || session.phase === "saving";
    button.setAttribute("aria-pressed", String(active));
    button.dataset.phase = session.phase;
    viewport.classList.toggle("is-trace-frozen", active);
    panel.hidden = !["saving", "save-error", "reviewing"].includes(session.phase);
    returnButton.disabled = session.phase !== "reviewing";
    emotionPad.tabIndex = session.phase === "reviewing" ? 0 : -1;
    emotionPad.setAttribute("aria-disabled", String(session.phase !== "reviewing"));
    if (!active) clearLassoLayer();
  }

  function showReview(traceId) {
    panel.hidden = false;
    panel.dataset.state = "saved";
    updateTraceSummary();
    renderEmotion(latestTrace?.emotion?.current ?? null);
    returnButton.disabled = false;
    setStatus("这一刻已先留在本机");
    clearLassoLayer();
    panel.dataset.traceId = traceId;
    panel.dataset.documentId = documentRecord?.id ?? "";
  }

  function showSaveError(errorCode) {
    panel.hidden = false;
    clearEmotion();
    panel.dataset.state = "error";
    summary.textContent = `痕迹尚未写入 · ${errorCode}`;
    returnButton.disabled = true;
    setStatus("本地保存失败；按 Esc 放弃，书页会保持暂停");
  }

  function handleEffects(effects) {
    for (const effect of effects) {
      switch (effect.type) {
        case "PAUSE_READING":
          onPause();
          break;
        case "CANCEL_TTS":
          onCancelSpeech();
          break;
        case "FREEZE_VIEWPORT":
          setStatus("用墨线圈住这一页的一瞬；Esc 取消");
          break;
        case "DISCARD_GESTURE":
          clearLassoLayer();
          setStatus(effect.reason === "cross-page" ? "航迹暂时只支持同一页" : "这次套索已取消");
          break;
        case "KEEP_PAUSED":
          setStatus("书页保持暂停；按空格或播放键继续");
          break;
        case "CREATE_TRACE_DRAFT":
          void persistDraft(effect);
          break;
        case "SHOW_TRACE_REVIEW":
          showReview(effect.traceId);
          break;
        case "SHOW_TRACE_SAVE_ERROR":
          showSaveError(effect.errorCode);
          break;
        case "BEGIN_REFLOW":
          panel.hidden = true;
          clearPreview();
          clearLassoLayer();
          onReturnToFlow({ traceId: effect.traceId });
          break;
        case "ABORT_TRACE_SESSION":
          panel.hidden = true;
          clearPreview();
          clearLassoLayer();
          break;
        default:
          break;
      }
    }
  }

  function dispatch(event) {
    const result = transitionTraceSession(session, event);
    if (!result.accepted) return result;
    session = result.state;
    handleEffects(result.effects);
    syncUi();
    return result;
  }

  function enqueueTraceMutation(documentId, traceId, mutation) {
    const run = traceMutationQueue
      .catch(() => {})
      .then(async () => {
        const current = latestTrace?.id === traceId
          ? latestTrace
          : await traceClient.readTrace(documentId, traceId);
        if (!current) throw new Error(`找不到 trace ${traceId}。`);
        const next = await mutation(current);
        if (documentRecord?.id === documentId && latestTrace?.id === traceId) {
          latestTrace = next;
          if (emotionMutationPending === 0 || next.emotion.state !== "unplaced") {
            emotionCoordinate = next.emotion.current;
            renderEmotion(emotionCoordinate);
          }
          updateTraceSummary();
        }
        return next;
      });
    traceMutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function markCropFailed(trace, error, documentId) {
    if (!trace || !documentId) return;
    try {
      await enqueueTraceMutation(documentId, trace.id, (current) => (
        traceClient.transitionTrace(
          documentId,
          trace.id,
          {
            type: "CROP_FAILED",
            errorCode: typeof error?.code === "string" ? error.code : "TRACE_CROP_FAILED",
          },
          { expectedRevision: current.revision },
        )
      ));
      setStatus("痕迹文字与路径已保存；裁图稍后可以重试");
    } catch (transitionError) {
      setStatus(`裁图失败：${transitionError.code ?? "TRACE_CROP_FAILED"}`);
    }
  }

  async function persistCrop(trace, shell, path, documentId) {
    const sourceCanvas = getPageCanvas(trace.pageIndex + 1, shell);
    if (!sourceCanvas) {
      await markCropFailed(trace, { code: "PAGE_CANVAS_UNAVAILABLE" }, documentId);
      return;
    }
    try {
      const crop = await renderLassoCrop({
        sourceCanvas,
        normalizedPath: path,
        padding: Math.max(12, Math.round((globalThis.devicePixelRatio || 1) * 12)),
      });
      const bytes = new Uint8Array(await crop.blob.arrayBuffer());
      await enqueueTraceMutation(documentId, trace.id, (current) => (
        traceClient.saveCrop(
          documentId,
          trace.id,
          bytes,
          {
            mimeType: crop.mimeType,
            width: crop.width,
            height: crop.height,
            expectedRevision: current.revision,
          },
        )
      ));
      clearPreview();
      previewUrl = URL.createObjectURL(crop.blob);
      preview.src = previewUrl;
      preview.alt = `第 ${trace.pageIndex + 1} 页航迹裁图`;
      preview.hidden = false;
      setStatus("截图、文字和路径已经留在本机");
    } catch (error) {
      await markCropFailed(trace, error, documentId);
    }
  }

  async function persistDraft(effect) {
    if (!documentRecord || effect.generation !== session.generation) return;
    const prepared = prepareLassoPath(effect.points);
    if (!prepared.valid) {
      dispatch({
        type: "SAVE_FAILED",
        generation: effect.generation,
        errorCode: prepared.reason ?? "INVALID_LASSO_PATH",
      });
      return;
    }
    const pageNumber = effect.pageIndex + 1;
    const selectedText = selectLassoText(getPageChunks(pageNumber), prepared.path);
    const speed = getSpeedContext();
    const shell = activeShell;
    const targetDocument = documentRecord;
    try {
      const trace = await traceClient.createDraft({
        id: createId(),
        documentId: targetDocument.id,
        documentFingerprint: targetDocument.fingerprint,
        pageIndex: effect.pageIndex,
        lassoPath: prepared.path,
        sourceText: selectedText.text,
        sourceProvenance: selectedText.provenance,
        speedTier: speed.speedTier,
        speedPxPerSecond: speed.speedPxPerSecond,
      });
      if (
        documentRecord?.id !== targetDocument.id ||
        effect.generation !== session.generation
      ) {
        return;
      }
      latestTrace = trace;
      emotionCoordinate = trace.emotion.current;
      renderEmotion(emotionCoordinate);
      const saved = dispatch({
        type: "SAVE_SUCCEEDED",
        generation: effect.generation,
        traceId: trace.id,
      });
      if (!saved.accepted) return;
      await persistCrop(trace, shell, prepared.path, targetDocument.id);
    } catch (error) {
      dispatch({
        type: "SAVE_FAILED",
        generation: effect.generation,
        errorCode: error?.code ?? "TRACE_SAVE_FAILED",
      });
    }
  }

  function placeEmotion(coordinate) {
    const normalized = normalizeEmotionCoordinate(coordinate);
    if (
      !normalized ||
      session.phase !== "reviewing" ||
      !documentRecord ||
      !latestTrace
    ) {
      return false;
    }
    const documentId = documentRecord.id;
    const traceId = latestTrace.id;
    emotionCoordinate = normalized;
    emotionMutationPending += 1;
    renderEmotion(normalized, { saving: true });
    void enqueueTraceMutation(documentId, traceId, (current) => (
      traceClient.transitionTrace(
        documentId,
        traceId,
        {
          type: current.emotion.state === "unplaced"
            ? "PLACE_EMOTION"
            : "REVISE_EMOTION",
          valence: normalized.valence,
          arousal: normalized.arousal,
        },
        { expectedRevision: current.revision },
      )
    )).then(() => {
      emotionMutationPending = Math.max(0, emotionMutationPending - 1);
      renderEmotion(emotionCoordinate, { saving: emotionMutationPending > 0 });
      setStatus("情绪坐标已留在本机");
    }).catch((error) => {
      emotionMutationPending = Math.max(0, emotionMutationPending - 1);
      emotionCoordinate = latestTrace?.emotion?.current ?? null;
      renderEmotion(emotionCoordinate, { saving: emotionMutationPending > 0 });
      setStatus(`情绪坐标保存失败：${error.code ?? "TRACE_EMOTION_FAILED"}`);
    });
    return true;
  }

  function emotionPoint(event) {
    return emotionFromPadPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rectangle: emotionPad.getBoundingClientRect(),
    });
  }

  function renderCurrentPath({ close = false } = {}) {
    if (!lassoLayer) return;
    lassoLayer.path.setAttribute("d", pathData(session.points, close));
  }

  function arm() {
    if (!desktopAvailable || !documentRecord || session.phase !== "idle") return false;
    clearPreview();
    clearEmotion();
    latestTrace = null;
    return dispatch({ type: "ARM" }).accepted;
  }

  function cancel(reason = "cancelled") {
    if (["armed", "drawing"].includes(session.phase)) {
      return dispatch({ type: "CANCEL", reason }).accepted;
    }
    if (session.phase !== "idle") {
      return dispatch({ type: "RESET", reason }).accepted;
    }
    return false;
  }

  function reset(reason = "reset") {
    dispatch({ type: "RESET", reason });
    activeShell = null;
    activePointerId = null;
    latestTrace = null;
    clearPreview();
    clearEmotion();
    syncUi();
  }

  function setDocument(record, { unavailableReason = "" } = {}) {
    reset("document-changed");
    documentRecord = record && typeof record === "object" ? record : null;
    if (!desktopAvailable) setStatus("航迹留痕只在桌面版中可用", { visible: false });
    else if (!documentRecord && unavailableReason) setStatus(unavailableReason);
    else setStatus("", { visible: false });
    syncUi();
  }

  function pointerDown(event) {
    if (session.phase !== "armed") return;
    const shell = event.target instanceof Element
      ? event.target.closest(".page-shell")
      : null;
    const pageNumber = pageNumberFromShell(shell);
    if (!shell || !pageNumber || !getPageCanvas(pageNumber, shell)) {
      setStatus("请等当前页清晰显影后再套索");
      return;
    }
    const point = normalizePointerToPage({
      clientX: event.clientX,
      clientY: event.clientY,
      rectangle: shell.getBoundingClientRect(),
    });
    if (!point) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    activeShell = shell;
    activePointerId = event.pointerId;
    lassoLayer = createLassoLayer(shell);
    setPointerCaptureSafely(pages, event.pointerId);
    dispatch({ type: "POINTER_DOWN", pageIndex: pageNumber - 1, point });
    renderCurrentPath();
  }

  function pointerMove(event) {
    if (session.phase !== "drawing" || event.pointerId !== activePointerId || !activeShell) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const targetShell = event.target instanceof Element
      ? event.target.closest(".page-shell")
      : null;
    if (targetShell && targetShell !== activeShell) {
      dispatch({
        type: "POINTER_MOVE",
        pageIndex: pageNumberFromShell(targetShell) - 1,
        point: { x: 0.5, y: 0.5 },
      });
      return;
    }
    const point = normalizePointerToPage({
      clientX: event.clientX,
      clientY: event.clientY,
      rectangle: activeShell.getBoundingClientRect(),
    });
    if (!point) {
      cancel("outside-page");
      return;
    }
    const sampled = sampleLassoPoint(session.points, point);
    if (sampled === session.points) return;
    dispatch({ type: "POINTER_MOVE", pageIndex: session.pageIndex, point: sampled.at(-1) });
    renderCurrentPath();
  }

  function pointerUp(event) {
    if (session.phase !== "drawing" || event.pointerId !== activePointerId || !activeShell) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    releasePointerCaptureSafely(pages, event.pointerId);
    activePointerId = null;
    const point = normalizePointerToPage({
      clientX: event.clientX,
      clientY: event.clientY,
      rectangle: activeShell.getBoundingClientRect(),
    });
    if (!point) {
      cancel("outside-page");
      return;
    }
    const prepared = prepareLassoPath([...session.points, point]);
    const result = dispatch({
      type: "POINTER_UP",
      pageIndex: session.pageIndex,
      point,
      valid: prepared.valid,
      reason: prepared.reason,
    });
    if (result.accepted && prepared.valid) renderCurrentPath({ close: true });
  }

  function pointerCancel(event) {
    if (event.pointerId !== activePointerId) return;
    releasePointerCaptureSafely(pages, event.pointerId);
    activePointerId = null;
    cancel("pointer-cancelled");
  }

  function keyDown(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === "KeyL") {
      if (!desktopAvailable || !documentRecord) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (session.phase === "idle") arm();
      else cancel("lasso-toggle");
      return;
    }
    if (event.code === "Escape" && session.phase !== "idle") {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel("escape");
    }
  }

  button.addEventListener("click", () => {
    if (session.phase === "idle") arm();
    else cancel("button-toggle");
  });
  returnButton.addEventListener("click", () => {
    dispatch({ type: "RETURN_TO_FLOW" });
  });
  emotionPad.addEventListener("pointerdown", (event) => {
    if (session.phase !== "reviewing") return;
    const coordinate = emotionPoint(event);
    if (!coordinate) return;
    event.preventDefault();
    setPointerCaptureSafely(emotionPad, event.pointerId);
    placeEmotion(coordinate);
  });
  emotionPad.addEventListener("pointermove", (event) => {
    if (session.phase !== "reviewing" || event.buttons !== 1) return;
    const coordinate = emotionPoint(event);
    if (!coordinate) return;
    event.preventDefault();
    placeEmotion(coordinate);
  });
  emotionPad.addEventListener("pointerup", (event) => {
    releasePointerCaptureSafely(emotionPad, event.pointerId);
  });
  emotionPad.addEventListener("keydown", (event) => {
    if (session.phase !== "reviewing") return;
    const coordinate = moveEmotionCoordinate(emotionCoordinate, event.code, {
      shiftKey: event.shiftKey,
    });
    if (!coordinate) return;
    event.preventDefault();
    event.stopPropagation();
    placeEmotion(coordinate);
  });
  pages.addEventListener("pointerdown", pointerDown, { capture: true });
  pages.addEventListener("pointermove", pointerMove, { capture: true, passive: false });
  pages.addEventListener("pointerup", pointerUp, { capture: true });
  pages.addEventListener("pointercancel", pointerCancel, { capture: true });
  pages.addEventListener("contextmenu", (event) => {
    if (session.phase === "idle") return;
    event.preventDefault();
    cancel("context-menu");
  }, { capture: true });
  window.addEventListener("keydown", keyDown, { capture: true });

  panel.hidden = true;
  preview.hidden = true;
  emotionMarker.hidden = true;
  status.hidden = true;
  clearEmotion();
  syncUi();

  return Object.freeze({
    snapshot,
    setDocument,
    arm,
    cancel,
    reset,
  });
}
