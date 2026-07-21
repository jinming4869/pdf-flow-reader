import * as pdfjsLib from "./vendor/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdf.worker.mjs",
  import.meta.url,
).href;

const elements = {
  viewport: document.querySelector("#viewport"),
  pages: document.querySelector("#pages"),
  loading: document.querySelector("#loading"),
  loadingText: document.querySelector("#loadingText"),
  documentName: document.querySelector("#documentName"),
  filePicker: document.querySelector("#filePicker"),
  toggle: document.querySelector("#toggle"),
  toggleIcon: document.querySelector("#toggleIcon"),
  toggleText: document.querySelector("#toggleText"),
  speed: document.querySelector("#speed"),
  speedValue: document.querySelector("#speedValue"),
  pageStatus: document.querySelector("#pageStatus"),
  progressBar: document.querySelector("#progressBar"),
  finish: document.querySelector("#finish"),
  backToTop: document.querySelector("#backToTop"),
  errorPanel: document.querySelector("#errorPanel"),
  errorText: document.querySelector("#errorText"),
};

let activePdf = null;
let loadGeneration = 0;
let pageShells = [];
let pageCount = 0;
let readyToMove = false;
let playing = true;
let wasPlayingBeforeHidden = false;
let speed = Number(elements.speed.value);
let easedSpeed = 0;
let scrollCarry = 0;
let lastFrame = 0;
let lastStatusUpdate = 0;

function speedLabel(value) {
  if (value <= 10) return "很慢";
  if (value <= 21) return "舒缓";
  if (value <= 35) return "适中";
  return "较快";
}

function setPlaying(next) {
  playing = next;
  elements.toggleIcon.textContent = playing ? "Ⅱ" : "▶";
  elements.toggleText.textContent = playing ? "暂停" : "继续";
  elements.toggle.setAttribute("aria-pressed", String(!playing));
}

function showError(error) {
  readyToMove = false;
  setPlaying(false);
  elements.toggle.disabled = true;
  elements.loading.hidden = true;
  elements.errorText.textContent =
    error instanceof Error ? error.message : String(error);
  elements.errorPanel.hidden = false;
}

function targetPageWidth() {
  return Math.max(280, Math.min(940, elements.viewport.clientWidth - 44));
}

async function renderPage(pdf, pageNumber, shell, generation) {
  const page = await pdf.getPage(pageNumber);
  if (generation !== loadGeneration) return;

  const baseViewport = page.getViewport({ scale: 1 });
  const cssWidth = Number(shell.dataset.width);
  const cssScale = cssWidth / baseViewport.width;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  canvas.setAttribute("aria-label", `第 ${pageNumber} 页`);
  shell.append(canvas);

  await page.render({ canvasContext: context, viewport: renderViewport }).promise;
  if (generation !== loadGeneration) return;
  shell.classList.add("rendered");
}

async function buildPageShells(pdf, generation) {
  const width = targetPageWidth();
  const shells = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    if (generation !== loadGeneration) return [];

    const viewport = page.getViewport({ scale: 1 });
    const height = Math.round(width * (viewport.height / viewport.width));
    const shell = document.createElement("section");
    shell.className = "page-shell";
    shell.dataset.page = String(pageNumber);
    shell.dataset.width = String(width);
    shell.style.width = `${width}px`;
    shell.style.height = `${height}px`;
    elements.pages.append(shell);
    shells.push(shell);
  }

  return shells;
}

async function openPdf(source, displayName) {
  const generation = ++loadGeneration;
  readyToMove = false;
  easedSpeed = 0;
  scrollCarry = 0;
  pageCount = 0;
  pageShells = [];
  elements.viewport.scrollTop = 0;
  elements.pages.replaceChildren();
  elements.finish.hidden = true;
  elements.errorPanel.hidden = true;
  elements.loading.hidden = false;
  elements.loadingText.textContent = "正在排版，请稍等";
  elements.documentName.textContent = displayName;
  elements.pageStatus.textContent = "准备中";
  elements.progressBar.style.width = "0%";
  elements.toggle.disabled = true;
  setPlaying(true);

  if (activePdf) {
    try {
      await activePdf.destroy();
    } catch {
      // A previous document may already be gone after a failed load.
    }
  }

  const task = pdfjsLib.getDocument(source);
  const pdf = await task.promise;
  if (generation !== loadGeneration) {
    await pdf.destroy();
    return;
  }

  activePdf = pdf;
  pageCount = pdf.numPages;
  document.title = `${displayName} · 缓缓读`;
  pageShells = await buildPageShells(pdf, generation);
  if (generation !== loadGeneration) return;

  elements.loadingText.textContent = `共 ${pageCount} 页，正在清晰化`;

  for (let index = 0; index < pageShells.length; index += 1) {
    await renderPage(pdf, index + 1, pageShells[index], generation);
    if (generation !== loadGeneration) return;

    if (index === 0) {
      elements.loading.hidden = true;
      elements.toggle.disabled = false;
      readyToMove = true;
      updateReadingStatus(true);
    }
  }

  elements.loading.hidden = true;
  elements.finish.hidden = false;
}

function currentPageNumber() {
  if (!pageShells.length) return 0;
  const readingLine = elements.viewport.scrollTop + elements.viewport.clientHeight * 0.38;
  let result = 1;

  for (let index = 0; index < pageShells.length; index += 1) {
    if (pageShells[index].offsetTop <= readingLine) result = index + 1;
    else break;
  }

  return result;
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

  const page = currentPageNumber();
  elements.pageStatus.textContent = page ? `${page} / ${pageCount} 页` : "准备中";
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
  speed = Number(elements.speed.value);
  elements.speedValue.textContent = speedLabel(speed);
});

elements.filePicker.addEventListener("change", async () => {
  const file = elements.filePicker.files?.[0];
  if (!file) return;

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    await openPdf({ data }, file.name);
  } catch (error) {
    showError(error);
  } finally {
    elements.filePicker.value = "";
  }
});

elements.backToTop.addEventListener("click", () => {
  elements.viewport.scrollTo({ top: 0, behavior: "smooth" });
  setPlaying(true);
});

elements.viewport.addEventListener("scroll", () => updateReadingStatus(true), {
  passive: true,
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

elements.speedValue.textContent = speedLabel(speed);
requestAnimationFrame(animate);

try {
  const configResponse = await fetch("./config.json", { cache: "no-store" });
  if (!configResponse.ok) throw new Error("阅读器没有取得本地文件信息。");
  const config = await configResponse.json();
  await openPdf({ url: "./document.pdf" }, config.fileName);
} catch (error) {
  showError(error);
}
