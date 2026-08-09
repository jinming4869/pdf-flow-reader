import {
  emotionFromPadPoint,
  emotionMarkerPosition,
  moveEmotionCoordinate,
  nearbyEmotionWords,
  normalizeEmotionCoordinate,
} from "./emotion-coordinate.mjs";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function required(value, name) {
  if (!value) throw new TypeError(`trace book controller 缺少 ${name}。`);
  return value;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function coordinatePosition(trace) {
  const coordinate = trace?.emotion?.current;
  if (!coordinate) return null;
  return {
    x: 20 + (coordinate.valence + 1) * 280,
    y: 20 + (1 - (coordinate.arousal + 1) / 2) * 320,
  };
}

function pageLabel(trace) {
  return `第 ${trace.pageIndex + 1} 页`;
}

export function createTraceBookController({
  elements,
  traceClient,
  onOpen = () => {},
  onJump = () => {},
} = {}) {
  const openButton = required(elements?.openButton, "openButton");
  const panel = required(elements?.panel, "panel");
  const closeButton = required(elements?.closeButton, "closeButton");
  const title = required(elements?.title, "title");
  const chart = required(elements?.chart, "chart");
  const list = required(elements?.list, "list");
  const image = required(elements?.image, "image");
  const meta = required(elements?.meta, "meta");
  const jumpButton = required(elements?.jumpButton, "jumpButton");
  const trashButton = required(elements?.trashButton, "trashButton");
  const trashViewButton = required(elements?.trashViewButton, "trashViewButton");
  const emotionPad = required(elements?.emotionPad, "emotionPad");
  const emotionMarker = required(elements?.emotionMarker, "emotionMarker");
  const emotionWords = required(elements?.emotionWords, "emotionWords");

  let currentDocument = null;
  let currentTitle = "";
  let traces = [];
  let selected = null;
  let showTrash = false;
  let imageUrl = null;
  let mutationQueue = Promise.resolve();

  function clearImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    image.removeAttribute("src");
    image.hidden = true;
  }

  function renderEmotion(coordinate) {
    const normalized = normalizeEmotionCoordinate(coordinate);
    const position = emotionMarkerPosition(normalized);
    if (!position) {
      emotionMarker.hidden = true;
      emotionWords.textContent = "尚未落点";
      emotionPad.removeAttribute("aria-valuetext");
      return;
    }
    emotionMarker.hidden = false;
    emotionMarker.style.left = `${position.leftPercent}%`;
    emotionMarker.style.top = `${position.topPercent}%`;
    const words = nearbyEmotionWords(normalized);
    emotionWords.textContent = words.join(" · ");
    emotionPad.setAttribute(
      "aria-valuetext",
      `效价 ${normalized.valence.toFixed(2)}，唤醒 ${normalized.arousal.toFixed(2)}；${words.join("、")}`,
    );
  }

  function clearDetail() {
    selected = null;
    clearImage();
    meta.textContent = showTrash ? "选择一条回收站记录。" : "选择一个航迹点查看详情。";
    renderEmotion(null);
    emotionPad.tabIndex = -1;
    emotionPad.setAttribute("aria-disabled", "true");
    jumpButton.disabled = true;
    trashButton.disabled = true;
  }

  function renderChart() {
    chart.replaceChildren();
    chart.append(
      svgElement("line", { x1: 20, y1: 180, x2: 580, y2: 180, class: "book-trace-axis" }),
      svgElement("line", { x1: 300, y1: 20, x2: 300, y2: 340, class: "book-trace-axis" }),
    );
    const placed = traces
      .filter((trace) => trace.lifecycle !== "trashed" && trace.emotion.current)
      .sort((left, right) => left.readingContext.readingOrder - right.readingContext.readingOrder);
    const positions = placed.map((trace) => ({ trace, ...coordinatePosition(trace) }));
    if (positions.length > 1) {
      chart.append(svgElement("polyline", {
        points: positions.map((point) => `${point.x},${point.y}`).join(" "),
        class: "book-trace-line",
      }));
    }
    for (const point of positions) {
      const circle = svgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: 7,
        class: "book-trace-point",
        tabindex: 0,
        role: "button",
        "aria-label": `${pageLabel(point.trace)}，阅读顺序 ${point.trace.readingContext.readingOrder}`,
        "data-trace-id": point.trace.id,
      });
      circle.addEventListener("click", () => void selectTrace(point.trace.id));
      circle.addEventListener("keydown", (event) => {
        if (!["Enter", "Space"].includes(event.code)) return;
        event.preventDefault();
        void selectTrace(point.trace.id);
      });
      chart.append(circle);
    }
  }

  function renderList() {
    list.replaceChildren();
    if (!traces.length) {
      const empty = document.createElement("p");
      empty.textContent = showTrash ? "回收站是空的。" : "这本书还没有航迹。";
      list.append(empty);
      return;
    }
    for (const trace of traces) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.dataset.traceId = trace.id;
      button.setAttribute("aria-current", String(trace.id === selected?.id));
      const emotion = trace.emotion.current
        ? `效价 ${trace.emotion.current.valence.toFixed(2)} · 唤醒 ${trace.emotion.current.arousal.toFixed(2)}`
        : "情绪待落点";
      button.textContent = `${pageLabel(trace)} · ${emotion}`;
      button.addEventListener("click", () => void selectTrace(trace.id));
      list.append(button);
    }
  }

  async function renderCrop(trace) {
    clearImage();
    if (trace.crop.state !== "ready") return;
    try {
      const crop = await traceClient.readCrop(currentDocument.id, trace.id);
      if (!crop?.bytes) return;
      const blob = new Blob([crop.bytes], { type: crop.mimeType || "image/png" });
      imageUrl = URL.createObjectURL(blob);
      image.src = imageUrl;
      image.alt = `${pageLabel(trace)}航迹裁图`;
      image.hidden = false;
    } catch (error) {
      meta.textContent += `\n裁图读取失败：${error.code ?? "TRACE_CROP_NOT_FOUND"}`;
    }
  }

  async function selectTrace(traceId) {
    const trace = traces.find((entry) => entry.id === traceId);
    if (!trace) return false;
    selected = trace;
    renderList();
    const coordinate = trace.emotion.current;
    const original = trace.emotion.original;
    meta.textContent = [
      `${pageLabel(trace)} · 阅读顺序 ${trace.readingContext.readingOrder}`,
      `${trace.readingContext.speedTier} · ${Math.round(trace.readingContext.speedPxPerSecond)} px/s`,
      trace.source.text || "圈选区域没有可用文字；截图与路径仍然有效。",
      original && coordinate && (
        original.valence !== coordinate.valence || original.arousal !== coordinate.arousal
      ) ? `最初坐标 ${original.valence.toFixed(2)}, ${original.arousal.toFixed(2)}` : "",
    ].filter(Boolean).join("\n");
    renderEmotion(coordinate);
    const editable = trace.lifecycle !== "trashed";
    emotionPad.tabIndex = editable ? 0 : -1;
    emotionPad.setAttribute("aria-disabled", String(!editable));
    jumpButton.disabled = false;
    trashButton.disabled = false;
    trashButton.textContent = trace.lifecycle === "trashed" ? "恢复航迹" : "移入回收站";
    await renderCrop(trace);
    return true;
  }

  async function refresh({ keepSelection = true } = {}) {
    if (!currentDocument) return;
    const all = await traceClient.listTraces(currentDocument.id, { includeTrashed: true });
    traces = all.filter((trace) => (
      showTrash ? trace.lifecycle === "trashed" : trace.lifecycle !== "trashed"
    ));
    const selectedId = keepSelection ? selected?.id : null;
    selected = selectedId ? traces.find((trace) => trace.id === selectedId) ?? null : null;
    renderChart();
    renderList();
    if (selected) await selectTrace(selected.id);
    else clearDetail();
  }

  function enqueueMutation(operation) {
    const run = mutationQueue.catch(() => {}).then(operation);
    mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  function placeEmotion(coordinate) {
    const normalized = normalizeEmotionCoordinate(coordinate);
    if (!normalized || !selected || selected.lifecycle === "trashed") return false;
    const documentId = currentDocument.id;
    const traceId = selected.id;
    renderEmotion(normalized);
    void enqueueMutation(async () => {
      const current = await traceClient.readTrace(documentId, traceId);
      const next = await traceClient.transitionTrace(
        documentId,
        traceId,
        {
          type: current.emotion.state === "unplaced" ? "PLACE_EMOTION" : "REVISE_EMOTION",
          valence: normalized.valence,
          arousal: normalized.arousal,
        },
        { expectedRevision: current.revision },
      );
      const index = traces.findIndex((trace) => trace.id === traceId);
      if (index >= 0) traces[index] = next;
      selected = next;
      renderChart();
      renderList();
      renderEmotion(next.emotion.current);
      return next;
    }).catch(() => void refresh());
    return true;
  }

  async function open({ documentId, title: displayTitle } = {}) {
    if (!traceClient?.available || !documentId) return false;
    currentDocument = { id: documentId };
    currentTitle = displayTitle || "一本书的航迹";
    onOpen();
    title.textContent = currentTitle;
    showTrash = false;
    trashViewButton.setAttribute("aria-pressed", "false");
    panel.hidden = false;
    clearDetail();
    await refresh({ keepSelection: false });
    closeButton.focus({ preventScroll: true });
    return true;
  }

  function close() {
    panel.hidden = true;
    clearImage();
    selected = null;
  }

  function setDocument(record, displayTitle = "") {
    currentDocument = record && typeof record === "object" ? { id: record.id } : null;
    currentTitle = displayTitle || record?.displayName || "";
    openButton.hidden = !traceClient?.available || !currentDocument;
    if (!currentDocument) close();
  }

  openButton.addEventListener("click", () => {
    if (currentDocument) void open({ documentId: currentDocument.id, title: currentTitle });
  });
  closeButton.addEventListener("click", close);
  trashViewButton.addEventListener("click", () => {
    showTrash = !showTrash;
    trashViewButton.setAttribute("aria-pressed", String(showTrash));
    void refresh({ keepSelection: false });
  });
  jumpButton.addEventListener("click", () => {
    if (!selected) return;
    const trace = selected;
    close();
    onJump(trace);
  });
  trashButton.addEventListener("click", () => {
    if (!selected) return;
    const trace = selected;
    void enqueueMutation(async () => {
      await traceClient.transitionTrace(
        currentDocument.id,
        trace.id,
        { type: trace.lifecycle === "trashed" ? "RESTORE" : "TRASH" },
        { expectedRevision: trace.revision },
      );
      await refresh({ keepSelection: false });
    });
  });
  emotionPad.addEventListener("pointerdown", (event) => {
    if (!selected || selected.lifecycle === "trashed") return;
    const coordinate = emotionFromPadPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rectangle: emotionPad.getBoundingClientRect(),
    });
    if (!coordinate) return;
    event.preventDefault();
    placeEmotion(coordinate);
  });
  emotionPad.addEventListener("keydown", (event) => {
    if (!selected || selected.lifecycle === "trashed") return;
    const coordinate = moveEmotionCoordinate(selected.emotion.current, event.code, {
      shiftKey: event.shiftKey,
    });
    if (!coordinate) return;
    event.preventDefault();
    placeEmotion(coordinate);
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && !panel.hidden) {
      event.preventDefault();
      close();
    }
  });

  openButton.hidden = true;
  panel.hidden = true;
  clearDetail();

  return Object.freeze({
    open,
    close,
    setDocument,
    refresh,
    snapshot: () => Object.freeze({
      open: !panel.hidden,
      documentId: currentDocument?.id ?? null,
      traceCount: traces.length,
      selectedTraceId: selected?.id ?? null,
      showTrash,
    }),
  });
}
