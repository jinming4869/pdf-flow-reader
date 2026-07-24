const DEFAULT_PIXELS_PER_PAGE = 4_800_000;

export function cacheBudgetForDeviceMemory(deviceMemory, { ocrEnabled = false } = {}) {
  let pages = 10;
  if (Number.isFinite(deviceMemory) && deviceMemory > 0) {
    if (deviceMemory <= 8) pages = 7;
    else if (deviceMemory <= 16) pages = 10;
    else pages = 14;
  }

  // Seven slots are the minimum that can hold current ±2 plus two pages in
  // the reading direction. On low-memory devices OCR therefore trims only
  // the pixel budget, not the required hot-page count.
  if (ocrEnabled) pages = Math.max(7, pages - 1);
  return {
    pages,
    pixels: Math.round(
      pages * DEFAULT_PIXELS_PER_PAGE * (ocrEnabled ? 0.9 : 1),
    ),
  };
}

export function directionalPageOrder(currentPage, direction, pageCount, limit = pageCount) {
  if (!Number.isInteger(currentPage) || currentPage < 1 || currentPage > pageCount) {
    return [];
  }

  const order = [currentPage];
  const seen = new Set(order);
  const sign = direction < 0 ? -1 : 1;
  const add = (pageNumber) => {
    if (
      order.length < limit &&
      pageNumber >= 1 &&
      pageNumber <= pageCount &&
      !seen.has(pageNumber)
    ) {
      order.push(pageNumber);
      seen.add(pageNumber);
    }
  };

  const targetLength = Math.min(limit, pageCount);

  // The current page and its two closest neighbours on each side are the
  // stable reading hot zone. Direction only decides which side wins ties.
  for (let distance = 1; distance <= 2 && order.length < targetLength; distance += 1) {
    add(currentPage + sign * distance);
    add(currentPage - sign * distance);
  }

  // Spend the remaining cache on two pages ahead for every one behind. A
  // final proximity pass fills gaps near the beginning or end of a document.
  for (let distance = 3; distance <= pageCount && order.length < targetLength; distance += 2) {
    add(currentPage + sign * distance);
    add(currentPage + sign * (distance + 1));
    add(currentPage - sign * distance);
  }
  for (let distance = 1; distance <= pageCount && order.length < targetLength; distance += 1) {
    add(currentPage + sign * distance);
    add(currentPage - sign * distance);
  }
  return order;
}

function abortError() {
  if (typeof DOMException === "function") {
    return new DOMException("页面渲染已取消", "AbortError");
  }
  const error = new Error("页面渲染已取消");
  error.name = "AbortError";
  return error;
}

export class RenderScheduler {
  constructor({
    render,
    budget = cacheBudgetForDeviceMemory(undefined),
    concurrency = 2,
    onError = () => {},
    onUpdate = () => {},
    now = () => performance.now(),
  }) {
    if (typeof render !== "function") throw new TypeError("render 必须是函数。");
    this.render = render;
    this.onError = onError;
    this.onUpdate = onUpdate;
    this.now = now;
    this.concurrency = concurrency;
    this.budget = { ...budget };
    this.currentPage = 0;
    this.pageCount = 0;
    this.direction = 1;
    this.hot = [];
    this.hotSet = new Set();
    this.queue = [];
    this.running = new Map();
    this.rendered = new Map();
    this.destroyed = false;
    this.sequence = 0;
    this.startedAt = this.now();
    this.firstRenderStartedAt = null;
    this.firstRenderCompletedAt = null;
    this.counts = { started: 0, completed: 0, cancelled: 0, failed: 0, evicted: 0 };
  }

  setBudget(budget) {
    this.budget = { ...budget };
    if (this.currentPage) this.updateView({
      currentPage: this.currentPage,
      direction: this.direction,
      pageCount: this.pageCount,
    });
  }

  updateView({ currentPage, direction = this.direction, pageCount = this.pageCount }) {
    if (this.destroyed) return;
    this.currentPage = currentPage;
    this.direction = direction < 0 ? -1 : 1;
    this.pageCount = pageCount;
    this.hot = directionalPageOrder(
      currentPage,
      this.direction,
      pageCount,
      Math.min(pageCount, this.budget.pages),
    );
    this.hotSet = new Set(this.hot);

    for (const [pageNumber, task] of this.running) {
      if (!this.hotSet.has(pageNumber)) this.#cancelTask(pageNumber, task);
    }

    // A short move can leave both render slots occupied by pages that are
    // still technically hot. Pre-empt the least important one so the newly
    // selected current page does not wait behind prefetch work.
    if (
      !this.rendered.has(currentPage) &&
      !this.running.has(currentPage) &&
      this.running.size >= this.concurrency
    ) {
      const priority = new Map(this.hot.map((pageNumber, index) => [pageNumber, index]));
      const candidate = [...this.running.entries()]
        .filter(([pageNumber, task]) => (
          pageNumber !== currentPage && !task.controller.signal.aborted
        ))
        .sort((left, right) => (
          (priority.get(right[0]) ?? Number.POSITIVE_INFINITY) -
          (priority.get(left[0]) ?? Number.POSITIVE_INFINITY)
        ))[0];
      if (candidate) this.#cancelTask(candidate[0], candidate[1]);
    }
    for (const [pageNumber, resource] of this.rendered) {
      if (!this.hotSet.has(pageNumber)) this.#evict(pageNumber, resource);
    }

    this.queue = this.hot.filter((pageNumber) => {
      const task = this.running.get(pageNumber);
      return (
        (!task || task.controller.signal.aborted) &&
        !this.rendered.has(pageNumber)
      );
    });
    const currentResource = this.rendered.get(currentPage);
    if (currentResource) currentResource.lastUsed = ++this.sequence;
    this.#enforceBudget();
    this.#pump();
    this.onUpdate();
  }

  reset() {
    if (this.destroyed) return;
    for (const [pageNumber, task] of this.running) {
      this.#cancelTask(pageNumber, task);
    }
    for (const [pageNumber, resource] of this.rendered) {
      this.#evict(pageNumber, resource);
    }
    this.queue = [];
    this.hot = [];
    this.hotSet.clear();
    this.currentPage = 0;
  }

  destroy() {
    this.reset();
    this.destroyed = true;
  }

  snapshot() {
    const canvasPixels = [...this.rendered.values()].reduce(
      (total, resource) => total + (resource.pixels || 0),
      0,
    );
    const currentResource = this.rendered.get(this.currentPage);
    return {
      timing: {
        elapsedMs: Math.round(this.now() - this.startedAt),
        firstRenderStartedMs: this.firstRenderStartedAt === null
          ? null
          : Math.round(this.firstRenderStartedAt - this.startedAt),
        firstRenderCompletedMs: this.firstRenderCompletedAt === null
          ? null
          : Math.round(this.firstRenderCompletedAt - this.startedAt),
      },
      render: { ...this.counts },
      canvas: {
        count: this.rendered.size,
        pixels: canvasPixels,
        estimatedBytes: canvasPixels * 4,
      },
      budget: { ...this.budget },
      hot: [...this.hot],
      queue: [...this.queue],
      running: [...this.running.keys()],
      currentPage: this.currentPage,
      currentQuality: currentResource?.quality ??
        (this.running.has(this.currentPage) ? "rendering" : "placeholder"),
    };
  }

  #cancelTask(pageNumber, task) {
    if (task.controller.signal.aborted) return;
    task.controller.abort(abortError());
    this.counts.cancelled += 1;
    this.onUpdate();
  }

  #evict(pageNumber, resource) {
    this.rendered.delete(pageNumber);
    resource.dispose?.();
    this.counts.evicted += 1;
    this.onUpdate();
  }

  #enforceBudget() {
    const pixels = () => [...this.rendered.values()].reduce(
      (total, resource) => total + (resource.pixels || 0),
      0,
    );
    while (
      this.rendered.size > this.budget.pages ||
      pixels() > this.budget.pixels
    ) {
      const candidates = [...this.rendered.entries()]
        .filter(([pageNumber]) => pageNumber !== this.currentPage)
        .sort((left, right) => {
          const distance = Math.abs(right[0] - this.currentPage) -
            Math.abs(left[0] - this.currentPage);
          return distance || (left[1].lastUsed ?? 0) - (right[1].lastUsed ?? 0);
        });
      if (!candidates.length) break;
      this.#evict(candidates[0][0], candidates[0][1]);
    }
  }

  #pump() {
    while (
      !this.destroyed &&
      this.running.size < this.concurrency &&
      this.queue.length
    ) {
      const pageNumber = this.queue.shift();
      if (!this.hotSet.has(pageNumber) || this.rendered.has(pageNumber)) continue;
      this.#start(pageNumber);
    }
  }

  #start(pageNumber) {
    const controller = new AbortController();
    const task = { controller, token: Symbol(`render-${pageNumber}`) };
    this.running.set(pageNumber, task);
    this.counts.started += 1;
    if (this.firstRenderStartedAt === null) this.firstRenderStartedAt = this.now();
    this.onUpdate();

    Promise.resolve()
      .then(() => this.render(pageNumber, { signal: controller.signal }))
      .then((resource) => {
        if (
          controller.signal.aborted ||
          this.destroyed ||
          this.running.get(pageNumber)?.token !== task.token ||
          !this.hotSet.has(pageNumber)
        ) {
          resource?.dispose?.();
          return;
        }
        resource.commit?.();
        resource.lastUsed = ++this.sequence;
        this.rendered.set(pageNumber, resource);
        this.counts.completed += 1;
        if (this.firstRenderCompletedAt === null) {
          this.firstRenderCompletedAt = this.now();
        }
        this.#enforceBudget();
        this.onUpdate();
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        this.counts.failed += 1;
        this.onError(error, pageNumber);
        this.onUpdate();
      })
      .finally(() => {
        if (this.running.get(pageNumber)?.token === task.token) {
          this.running.delete(pageNumber);
        }
        this.#pump();
        this.onUpdate();
      });
  }
}
