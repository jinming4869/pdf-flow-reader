const { app, BrowserWindow, ipcMain } = require("electron");
const {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const root = resolve(__dirname, "..");
const integrationPreload = join(__dirname, "electron-integration-preload.cjs");
const productPreload = join(root, "electron-preload.cjs");
const tempRoot = mkdtempSync(join(tmpdir(), "night-study-integration-"));
const profileRoot = join(tempRoot, "electron-profile");
const captureDirectory = process.env.ELECTRON_SMOKE_CAPTURE_DIR
  ? resolve(process.env.ELECTRON_SMOKE_CAPTURE_DIR)
  : null;

mkdirSync(profileRoot, { recursive: true });
app.setPath("userData", profileRoot);
app.once("quit", () => rmSync(tempRoot, { recursive: true, force: true }));

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function createSyntheticPdf(filePath) {
  const stream = [
    "BT",
    "/F1 24 Tf",
    "72 700 Td",
    "(Night Study integration smoke) Tj",
    "0 -40 Td",
    "/F1 14 Tf",
    "(Local synthetic PDF. No private document content.) Tj",
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<AABBCCDDEEFF00112233445566778899><AABBCCDDEEFF00112233445566778899>] >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  writeFileSync(filePath, body);
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("Integration server did not receive a TCP port."));
        return;
      }
      resolveListen(`http://127.0.0.1:${address.port}/`);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose) => server.close(resolveClose));
}

function createWindow(preloadPath = integrationPreload) {
  return new BrowserWindow({
    width: 1180,
    height: 860,
    show: false,
    backgroundColor: "#f5efe6",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });
}

async function loadUrl(window, url, label) {
  try {
    await window.loadURL(url);
  } catch (error) {
    throw new Error(`${label} failed to load ${url}: ${error.message}`, { cause: error });
  }
}

async function waitFor(window, expression, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await window.webContents.executeJavaScript(expression, true)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for renderer expression: ${expression}`);
}

async function seedShelf(window) {
  await window.webContents.executeJavaScript(`(() => {
    const now = new Date().toISOString();
    const documents = {};
    ["庄子集释.pdf", "Feynman Lectures.pdf", "李商隐诗选.pdf"].forEach((fileName, index) => {
      const id = "doc_smoke_" + index;
      documents[id] = {
        id,
        fileName,
        fileSize: 1000 + index,
        lastModified: 1700000000000 + index,
        fingerprint: "smoke:" + index,
        lastPageIndex: index * 10,
        lastScrollTop: index * 100,
        progressRatio: [0.18, 0.42, 0.67][index],
        lastSpeedPxPerSecond: [8, 16, 24][index],
        lastBandKey: ["snow-mist", "aesthetic-walk", "long-day"][index],
        openedAt: now,
        updatedAt: new Date(Date.now() - index * 1000).toISOString(),
      };
    });
    localStorage.setItem("pdf-flow-reader:v3:local-state", JSON.stringify({
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      documents,
      rhythmRecords: {},
      preferences: { recentDocumentLimit: 6, restoreLastPositionEnabled: true },
    }));
    return true;
  })()`, true);
}

async function probeShelf(window) {
  return window.webContents.executeJavaScript(`(() => {
    const list = document.querySelector("#recentBooks");
    const selected = document.querySelector(".recent-book-card.is-selected");
    let pointerProbe = null;
    selected.addEventListener("pointerdown", (event) => {
      pointerProbe = {
        type: event.pointerType,
        x: event.clientX,
        y: event.clientY,
      };
    }, { once: true });
    selected.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 24,
      clientY: 32,
    }));
    list.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "ArrowRight",
      key: "ArrowRight",
    }));
    return {
      cardCount: document.querySelectorAll(".recent-book-card").length,
      selectedTitle: document.querySelector("#bookSelectionTitle").textContent,
      pointerProbe,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`, true);
}

async function capture(window, filename) {
  if (!captureDirectory) return null;
  mkdirSync(captureDirectory, { recursive: true });
  const target = join(captureDirectory, filename);
  writeFileSync(target, (await window.webContents.capturePage()).toPNG());
  return filename;
}

function closeWindow(window) {
  if (window.isDestroyed()) return Promise.resolve();
  return new Promise((resolveClose) => {
    window.once("closed", resolveClose);
    window.close();
  });
}

async function run() {
  const pdfPath = join(tempRoot, "integration-smoke.pdf");
  createSyntheticPdf(pdfPath);

  const [
    { createReaderServer },
    { createTraceRepository },
    { registerTraceIpc },
  ] = await Promise.all([
    import(pathToFileURL(join(root, "server.mjs")).href),
    import(pathToFileURL(join(root, "trace-repository.mjs")).href),
    import(pathToFileURL(join(root, "trace-ipc.mjs")).href),
  ]);
  const shelfServer = createReaderServer({ appRoot: root });
  const readerServer = createReaderServer({ appRoot: root, pdfPath });
  const traceRepository = createTraceRepository({ rootPath: join(tempRoot, "trace-store") });
  await traceRepository.initialize();
  await traceRepository.recover();
  const windows = [];

  ipcMain.handle("night-study:integration-ping", () => ({ ok: true, channel: "isolated-preload" }));
  const disposeTraceIpc = registerTraceIpc({ ipcMain, repository: traceRepository });

  try {
    const [shelfUrl, readerUrl] = await Promise.all([
      listen(shelfServer),
      listen(readerServer),
    ]);

    const firstWindow = createWindow();
    windows.push(firstWindow);
    await loadUrl(firstWindow, shelfUrl, "initial shelf");
    await seedShelf(firstWindow);
    await loadUrl(firstWindow, shelfUrl, "seeded shelf");
    await waitFor(firstWindow, `document.querySelectorAll(".recent-book-card").length === 4`);
    await waitFor(firstWindow, `document.querySelector("#homeEcho")?.classList.contains("is-ready")`);

    const shelf = await probeShelf(firstWindow);
    const ipc = await firstWindow.webContents.executeJavaScript(
      `window.__nightStudyIntegration.ping()`,
      true,
    );
    await firstWindow.webContents.executeJavaScript(`(() => {
      document.querySelector("#homeEcho")?.scrollIntoView({ block: "center" });
      return true;
    })()`, true);
    await wait(700);
    shelf.selectedOpacity = await firstWindow.webContents.executeJavaScript(
      `Number.parseFloat(getComputedStyle(document.querySelector(".recent-book-card.is-selected")).opacity)`,
      true,
    );
    if (shelf.selectedOpacity < 0.99) {
      throw new Error(`Selected shelf card did not become visible: ${shelf.selectedOpacity}`);
    }
    const shelfCapture = await capture(firstWindow, "electron-bookshelf.png");
    await closeWindow(firstWindow);
    await wait(100);

    const restartedWindow = createWindow();
    windows.push(restartedWindow);
    await loadUrl(restartedWindow, shelfUrl, "restarted shelf");
    await waitFor(restartedWindow, `document.querySelectorAll(".recent-book-card").length === 4`);
    const restartPersistence = await restartedWindow.webContents.executeJavaScript(`(() => ({
      cardCount: document.querySelectorAll(".recent-book-card").length,
      firstTitle: document.querySelector(".recent-book-card")?.getAttribute("aria-label") || "",
    }))()`, true);

    await loadUrl(restartedWindow, readerUrl, "synthetic PDF reader");
    await waitFor(
      restartedWindow,
      `document.querySelectorAll("canvas.page-canvas").length === 1 && document.querySelector(".page-shell.rendered")`,
    );
    const reader = await restartedWindow.webContents.executeJavaScript(`(() => ({
      title: document.title,
      documentName: document.querySelector("#documentName").textContent,
      pageStatus: document.querySelector("#pageStatus").textContent,
      canvasCount: document.querySelectorAll("canvas.page-canvas").length,
      canvasSize: (() => {
        const canvas = document.querySelector("canvas.page-canvas");
        return [canvas.width, canvas.height];
      })(),
      renderedShellCount: document.querySelectorAll(".page-shell.rendered").length,
      homeButtonVisible: getComputedStyle(document.querySelector("#homeButton")).display !== "none",
      errorHidden: document.querySelector("#errorPanel").hidden,
    }))()`, true);
    const readerCapture = await capture(restartedWindow, "electron-reader.png");
    const cropProbe = await restartedWindow.webContents.executeJavaScript(`(async () => {
      const { renderLassoCrop } = await import("/trace-crop.mjs");
      const path = [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 },
      ];
      const pdfCanvas = document.querySelector("canvas.page-canvas");
      const pdfCrop = await renderLassoCrop({
        sourceCanvas: pdfCanvas,
        normalizedPath: path,
        padding: 24,
        maxPixels: 4_000_000,
      });

      const largeCanvas = document.createElement("canvas");
      largeCanvas.width = 3000;
      largeCanvas.height = 4000;
      const context = largeCanvas.getContext("2d", { alpha: false });
      const gradient = context.createLinearGradient(0, 0, 3000, 4000);
      gradient.addColorStop(0, "#f5efe6");
      gradient.addColorStop(1, "#24362d");
      context.fillStyle = gradient;
      context.fillRect(0, 0, largeCanvas.width, largeCanvas.height);
      const largeRuns = [];
      let largeCrop = null;
      for (let index = 0; index < 5; index += 1) {
        largeCrop = await renderLassoCrop({
          sourceCanvas: largeCanvas,
          normalizedPath: path,
          padding: 40,
          maxPixels: 4_000_000,
        });
        largeRuns.push(largeCrop.durationMs);
      }
      largeCanvas.width = 1;
      largeCanvas.height = 1;

      if (pdfCrop.byteLength <= 0 || largeCrop.byteLength <= 0) {
        throw new Error("Crop probe produced an empty Blob.");
      }
      const durations = largeRuns.slice().sort((left, right) => left - right);
      const rounded = (value) => Math.round(value * 100) / 100;
      return {
        pdf: {
          source: [pdfCanvas.width, pdfCanvas.height],
          output: [pdfCrop.width, pdfCrop.height],
          bytes: pdfCrop.byteLength,
          durationMs: Math.round(pdfCrop.durationMs * 100) / 100,
        },
        large: {
          source: [3000, 4000],
          output: [largeCrop.width, largeCrop.height],
          outputPixels: largeCrop.plan.outputPixels,
          estimatedPeakPixelBytes: 3000 * 4000 * 4 + largeCrop.plan.outputPixels * 4,
          bytes: largeCrop.byteLength,
          iterations: durations.length,
          p50DurationMs: rounded(durations[Math.floor((durations.length - 1) * 0.5)]),
          p95DurationMs: rounded(durations[Math.floor((durations.length - 1) * 0.95)]),
          maximumDurationMs: rounded(durations.at(-1)),
        },
      };
    })()`, true);

    const productWindow = createWindow(productPreload);
    windows.push(productWindow);
    await loadUrl(productWindow, shelfUrl, "product trace preload");
    await waitFor(productWindow, `typeof window.nightStudyTrace === "object"`);
    const traceBridge = await productWindow.webContents.executeJavaScript(`(async () => {
      const api = window.nightStudyTrace;
      const call = async (method, ...args) => {
        const response = await api[method](...args);
        if (!response?.ok) {
          const error = new Error(response?.error?.message || "Trace operation failed.");
          error.code = response?.error?.code || "TRACE_IPC_FAILED";
          throw error;
        }
        return response.value;
      };
      const capabilities = await call("capabilities");
      const registeredDocument = await call("registerDocument", {
        id: "doc-integration",
        fingerprint: "sha256:integration-document",
        displayName: "integration-smoke.pdf",
        fileSize: 1024,
      });
      const created = await call("createDraft", {
        id: "trace-integration",
        documentId: registeredDocument.id,
        documentFingerprint: registeredDocument.fingerprint,
        pageIndex: 0,
        lassoPath: [
          { x: 0.1, y: 0.1 },
          { x: 0.8, y: 0.1 },
          { x: 0.4, y: 0.8 },
        ],
        sourceText: "Synthetic trace text.",
        sourceProvenance: "native",
        speedTier: "long-day",
        speedPxPerSecond: 20,
      });
      const { renderLassoCrop } = await import("/trace-crop.mjs");
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = 64;
      cropCanvas.height = 64;
      const cropContext = cropCanvas.getContext("2d", { alpha: false });
      cropContext.fillStyle = "#527562";
      cropContext.fillRect(0, 0, 64, 64);
      const crop = await renderLassoCrop({
        sourceCanvas: cropCanvas,
        normalizedPath: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        padding: 0,
      });
      const cropBytes = new Uint8Array(await crop.blob.arrayBuffer());
      const savedCrop = await call(
        "saveCrop",
        registeredDocument.id,
        created.id,
        cropBytes,
        {
          mimeType: crop.mimeType,
          width: crop.width,
          height: crop.height,
          expectedRevision: created.revision,
        },
      );
      const listed = await call("listTraces", registeredDocument.id);
      let conflictCode = null;
      try {
        await call(
          "transitionTrace",
          registeredDocument.id,
          created.id,
          { type: "RETRY_CROP" },
          { expectedRevision: created.revision },
        );
      } catch (error) {
        conflictCode = error.code || null;
      }
      if (conflictCode !== "TRACE_REVISION_CONFLICT") {
        throw new Error("Trace IPC lost its public error code: " + conflictCode);
      }
      return {
        capabilities,
        documentId: registeredDocument.id,
        traceId: created.id,
        readingOrder: created.readingContext.readingOrder,
        listedCount: listed.length,
        cropState: savedCrop.crop.state,
        cropBytes: crop.byteLength,
        revision: savedCrop.revision,
        conflictCode,
        pathForFileType: typeof api.pathForFile,
      };
    })()`, true);

    await loadUrl(productWindow, readerUrl, "product trace capture UI");
    await waitFor(
      productWindow,
      `!document.querySelector("#traceLassoButton").hidden && document.querySelector("canvas.page-canvas")`,
    );
    await productWindow.webContents.executeJavaScript(`(() => {
      const button = document.querySelector("#traceLassoButton");
      const canvas = document.querySelector("canvas.page-canvas");
      const rectangle = canvas.getBoundingClientRect();
      const fire = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 77,
        pointerType: "mouse",
        button: 0,
        buttons,
        clientX: rectangle.left + rectangle.width * x,
        clientY: rectangle.top + rectangle.height * y,
      }));
      button.click();
      fire("pointerdown", 0.2, 0.2, 1);
      fire("pointermove", 0.8, 0.2, 1);
      fire("pointermove", 0.8, 0.8, 1);
      fire("pointermove", 0.2, 0.8, 1);
      fire("pointerup", 0.2, 0.2, 0);
      return true;
    })()`, true);
    await waitFor(
      productWindow,
      `document.querySelector("#tracePanel")?.dataset.state === "saved"`,
      15_000,
    );
    await productWindow.webContents.executeJavaScript(`(() => {
      const pad = document.querySelector("#emotionPad");
      const rectangle = pad.getBoundingClientRect();
      pad.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 88,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: rectangle.left + rectangle.width * 0.75,
        clientY: rectangle.top + rectangle.height * 0.25,
      }));
      pad.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 88,
        pointerType: "mouse",
        button: 0,
        buttons: 0,
        clientX: rectangle.left + rectangle.width * 0.75,
        clientY: rectangle.top + rectangle.height * 0.25,
      }));
      return true;
    })()`, true);
    await waitFor(
      productWindow,
      `!document.querySelector("#tracePreview").hidden && !document.querySelector("#emotionMarker").hidden && document.querySelector("#traceSummary").textContent.includes("情绪已落点")`,
      15_000,
    );
    const uiTraceCapture = await productWindow.webContents.executeJavaScript(`(async () => {
      const panel = document.querySelector("#tracePanel");
      const response = await window.nightStudyTrace.listTraces(panel.dataset.documentId);
      if (!response?.ok) throw new Error(response?.error?.message || "Unable to list UI traces.");
      const trace = response.value.find((entry) => entry.id === panel.dataset.traceId);
      return {
        traceId: panel.dataset.traceId,
        documentId: panel.dataset.documentId,
        traceCount: response.value.length,
        cropState: trace?.crop?.state || null,
        emotionState: trace?.emotion?.state || null,
        emotionCoordinate: trace?.emotion?.current || null,
        sourceProvenance: trace?.source?.provenance || null,
        emotionWords: document.querySelector("#emotionWords").textContent,
        emotionValueText: document.querySelector("#emotionPad").getAttribute("aria-valuetext"),
        panelState: panel.dataset.state,
        previewVisible: !document.querySelector("#tracePreview").hidden,
        buttonPressed: document.querySelector("#traceLassoButton").getAttribute("aria-pressed"),
        viewportFrozen: document.querySelector("#viewport").classList.contains("is-trace-frozen"),
        summary: document.querySelector("#traceSummary").textContent,
      };
    })()`, true);
    await productWindow.webContents.executeJavaScript(`(() => {
      const pad = document.querySelector("#emotionPad");
      pad.focus();
      pad.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "ArrowLeft",
        key: "ArrowLeft",
      }));
      return true;
    })()`, true);
    await waitFor(
      productWindow,
      `(async () => {
        const panel = document.querySelector("#tracePanel");
        const response = await window.nightStudyTrace.readTrace(
          panel.dataset.documentId,
          panel.dataset.traceId,
        );
        return Boolean(
          document.querySelector("#emotionPad").getAttribute("aria-valuetext")?.includes("效价 0.45") &&
          response?.ok &&
          response.value?.emotion?.current?.valence === 0.45
        );
      })()`,
    );
    uiTraceCapture.keyboardAdjustment = await productWindow.webContents.executeJavaScript(`(async () => {
      const panel = document.querySelector("#tracePanel");
      const response = await window.nightStudyTrace.readTrace(
        panel.dataset.documentId,
        panel.dataset.traceId,
      );
      if (!response?.ok) throw new Error(response?.error?.message || "Unable to read trace.");
      return {
        emotionState: response.value.emotion.state,
        original: response.value.emotion.original,
        current: response.value.emotion.current,
        words: document.querySelector("#emotionWords").textContent,
      };
    })()`, true);
    const traceCaptureScreenshot = await capture(productWindow, "electron-trace-saved.png");
    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#traceReturnButton").click()`,
      true,
    );
    await waitFor(
      productWindow,
      `document.querySelector("#tracePanel").hidden && !document.querySelector("#viewport").classList.contains("is-trace-frozen")`,
    );
    await waitFor(
      productWindow,
      `document.querySelector("#speedExperience").dataset.motion === "reflow"`,
    );
    uiTraceCapture.afterReturn = await productWindow.webContents.executeJavaScript(`(() => ({
      panelHidden: document.querySelector("#tracePanel").hidden,
      viewportFrozen: document.querySelector("#viewport").classList.contains("is-trace-frozen"),
      buttonPressed: document.querySelector("#traceLassoButton").getAttribute("aria-pressed"),
      reflowMotion: document.querySelector("#speedExperience").dataset.motion,
      reflowStatus: document.querySelector("#traceStatus").textContent,
    }))()`, true);
    await productWindow.webContents.executeJavaScript(`(() => {
      document.querySelector("#viewport").dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 24,
      }));
      return true;
    })()`, true);
    await waitFor(
      productWindow,
      `document.querySelector("#speedExperience").dataset.motion === "idle"`,
    );
    const reflowProbe = await productWindow.webContents.executeJavaScript(`(() => ({
      startedMotion: "reflow",
      cancelledMotion: document.querySelector("#speedExperience").dataset.motion,
      cancelledStatus: document.querySelector("#traceStatus").textContent,
      playbackLabel: document.querySelector("#toggleText").textContent,
      viewportFrozen: document.querySelector("#viewport").classList.contains("is-trace-frozen"),
    }))()`, true);
    uiTraceCapture.cancelProbe = await productWindow.webContents.executeJavaScript(`(async () => {
      const panel = document.querySelector("#tracePanel");
      const list = async () => {
        const response = await window.nightStudyTrace.listTraces(panel.dataset.documentId);
        if (!response?.ok) throw new Error(response?.error?.message || "Unable to list traces.");
        return response.value;
      };
      const before = await list();
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyL",
        key: "l",
      }));
      const armed = {
        buttonPressed: document.querySelector("#traceLassoButton").getAttribute("aria-pressed"),
        viewportFrozen: document.querySelector("#viewport").classList.contains("is-trace-frozen"),
      };
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Escape",
        key: "Escape",
      }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const after = await list();
      return {
        traceCountBefore: before.length,
        traceCountAfter: after.length,
        armed,
        afterCancel: {
          buttonPressed: document.querySelector("#traceLassoButton").getAttribute("aria-pressed"),
          viewportFrozen: document.querySelector("#viewport").classList.contains("is-trace-frozen"),
          panelHidden: document.querySelector("#tracePanel").hidden,
          playbackLabel: document.querySelector("#toggleText").textContent,
        },
      };
    })()`, true);
    if (uiTraceCapture.cancelProbe.traceCountAfter !== uiTraceCapture.cancelProbe.traceCountBefore) {
      throw new Error("Cancelling a lasso unexpectedly created a trace.");
    }

    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#traceBookButton").click()`,
      true,
    );
    await waitFor(
      productWindow,
      `!document.querySelector("#bookTracePanel").hidden && document.querySelector("#bookTraceList button")`,
    );
    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceList button").click()`,
      true,
    );
    await waitFor(
      productWindow,
      `!document.querySelector("#bookTraceImage").hidden && !document.querySelector("#bookTraceJump").disabled`,
    );
    await productWindow.webContents.executeJavaScript(`(() => {
      const pad = document.querySelector("#bookEmotionPad");
      const rectangle = pad.getBoundingClientRect();
      pad.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 99,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: rectangle.left + rectangle.width * 0.25,
        clientY: rectangle.top + rectangle.height * 0.75,
      }));
      return true;
    })()`, true);
    await waitFor(
      productWindow,
      `(async () => {
        const response = await window.nightStudyTrace.readTrace(
          ${JSON.stringify(uiTraceCapture.documentId)},
          ${JSON.stringify(uiTraceCapture.traceId)}
        );
        return response?.ok && response.value?.emotion?.current?.valence === -0.5;
      })()`,
    );
    const bookTraceProbe = await productWindow.webContents.executeJavaScript(`(async () => {
      const response = await window.nightStudyTrace.readTrace(
        ${JSON.stringify(uiTraceCapture.documentId)},
        ${JSON.stringify(uiTraceCapture.traceId)}
      );
      if (!response?.ok) throw new Error(response?.error?.message || "Unable to read book trace.");
      return {
        panelOpen: !document.querySelector("#bookTracePanel").hidden,
        chartPoints: document.querySelectorAll(".book-trace-point").length,
        listItems: document.querySelectorAll("#bookTraceList button").length,
        imageVisible: !document.querySelector("#bookTraceImage").hidden,
        correctedEmotion: response.value.emotion.current,
        originalEmotion: response.value.emotion.original,
        emotionWords: document.querySelector("#bookEmotionWords").textContent,
      };
    })()`, true);
    const bookTraceScreenshot = await capture(productWindow, "electron-book-trace.png");

    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceJump").click()`,
      true,
    );
    await waitFor(
      productWindow,
      `document.querySelector("#bookTracePanel").hidden && document.querySelector("#traceStatus").textContent.includes("已回到第 1 页")`,
    );
    bookTraceProbe.jumpStatus = await productWindow.webContents.executeJavaScript(
      `document.querySelector("#traceStatus").textContent`,
      true,
    );

    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#traceBookButton").click()`,
      true,
    );
    await waitFor(productWindow, `document.querySelector("#bookTraceList button")`);
    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceList button").click(); document.querySelector("#bookTraceTrash").click()`,
      true,
    );
    await waitFor(productWindow, `!document.querySelector("#bookTraceList button")`);
    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceTrashView").click()`,
      true,
    );
    await waitFor(productWindow, `document.querySelector("#bookTraceList button")`);
    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceList button").click()`,
      true,
    );
    bookTraceProbe.trashButtonLabel = await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceTrash").textContent`,
      true,
    );
    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceTrash").click()`,
      true,
    );
    await waitFor(productWindow, `!document.querySelector("#bookTraceList button")`);
    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceTrashView").click()`,
      true,
    );
    await waitFor(productWindow, `document.querySelector("#bookTraceList button")`);
    bookTraceProbe.restoredListItems = await productWindow.webContents.executeJavaScript(
      `document.querySelectorAll("#bookTraceList button").length`,
      true,
    );
    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#bookTraceClose").click()`,
      true,
    );

    await productWindow.webContents.executeJavaScript(
      `document.querySelector("#homeButton").click()`,
      true,
    );
    await waitFor(
      productWindow,
      `!document.querySelector("#emptyState").hidden && document.querySelector("#controls").hidden && document.querySelectorAll("canvas.page-canvas").length === 0`,
    );
    const homeNavigationProbe = await productWindow.webContents.executeJavaScript(`(() => ({
      title: document.title,
      emptyVisible: !document.querySelector("#emptyState").hidden,
      controlsHidden: document.querySelector("#controls").hidden,
      homeButtonHidden: document.querySelector("#homeButton").hidden,
      homeButtonDisplayed: getComputedStyle(document.querySelector("#homeButton")).display !== "none",
      canvasCount: document.querySelectorAll("canvas.page-canvas").length,
      recentBookCount: document.querySelectorAll(".recent-book-card").length,
    }))()`, true);
    if (homeNavigationProbe.recentBookCount < 1) {
      throw new Error("Returning to the shelf lost the recent reading record.");
    }
    if (homeNavigationProbe.homeButtonDisplayed) {
      throw new Error("The return-to-shelf action remained visually present on the shelf.");
    }

    return {
      ok: true,
      security: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      ipc,
      traceBridge,
      uiTraceCapture,
      reflowProbe,
      bookTraceProbe,
      homeNavigationProbe,
      cropProbe,
      shelf,
      restartPersistence,
      reader,
      captures: [
        shelfCapture,
        readerCapture,
        traceCaptureScreenshot,
        bookTraceScreenshot,
      ].filter(Boolean),
    };
  } finally {
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
    disposeTraceIpc();
    ipcMain.removeHandler("night-study:integration-ping");
    await Promise.all([closeServer(shelfServer), closeServer(readerServer)]);
  }
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.on("window-all-closed", () => {});
app.whenReady()
  .then(run)
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
