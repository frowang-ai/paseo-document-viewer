import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
const $ = (id) => document.getElementById(id);
const korean = navigator.language.startsWith("ko");
const tr = (text) =>
  korean
    ? text
    : ({
        "PDF 리소스 응답 시간 초과": "PDF resource timed out",
        "PDF를 열지 못했습니다. ": "Could not open the PDF. ",
        "찾는 중…": "Searching…",
        "검색 결과 없음": "No matches",
      }[text] ?? text);
if (!korean) {
  document.documentElement.lang = "en";
  for (const [id, label] of Object.entries({
    prev: "Previous page",
    number: "Page",
    next: "Next page",
    out: "Zoom out",
    in: "Zoom in",
    search: "Search document",
    secret: "PDF password",
  }))
    $(id).setAttribute("aria-label", label);
  $("fit").textContent = "Fit width";
  $("find").textContent = "Find";
  $("unlock").textContent = "Open";
  $("search").placeholder = "Search document";
  $("message").textContent = "Loading PDF…";
  $("password").firstChild.textContent = "This PDF requires a password. ";
}
const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const input = window.__PDF_DOCUMENT__;
delete window.__PDF_DOCUMENT__;
const worker = URL.createObjectURL(new Blob([decode(input.worker)], { type: "text/javascript" }));
pdfjs.GlobalWorkerOptions.workerSrc = worker;
const pending = new Map();
let serial = 0;
function asset(kind, name) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    parent.postMessage({ channel: "paseo-doc-pdf", id, kind, name }, "*");
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(tr("PDF 리소스 응답 시간 초과")));
    }, 15000);
  });
}
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.channel !== "paseo-doc-pdf-result") return;
  const p = pending.get(event.data.id);
  if (!p) return;
  pending.delete(event.data.id);
  event.data.error ? p.reject(new Error(event.data.error)) : p.resolve(decode(event.data.base64));
});
class CMaps {
  async fetch({ name }) {
    return { cMapData: await asset("cmaps", name + ".bcmap"), isCompressed: true };
  }
}
class Fonts {
  async fetch({ filename }) {
    return asset("standard_fonts", filename);
  }
}
class Wasm {
  async fetch({ filename }) {
    return asset("wasm", filename);
  }
}
const scroll = $("scroll"),
  pages = [],
  gap = 20;
let pdf,
  number = input.page,
  scale = 1,
  fit = true,
  restoreScroll,
  renderPending = false,
  drawing = false,
  disposed = false,
  visible = [],
  scrollFrame,
  viewportWidth,
  viewportHeight,
  readingAnchor;

// Keep scrollY relative to the current page, as in the original single-page viewer.
// Existing saved positions therefore also work in the continuous layout.
function position() {
  const entry = pages[number - 1];
  return {
    x: scroll.scrollLeft,
    y: entry?.top ? Math.max(0, scroll.scrollTop - entry.top + gap) : 0,
    scale,
  };
}
function pageAt(y) {
  let low = 0,
    high = pages.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (pages[mid].top <= y) low = mid;
    else high = mid - 1;
  }
  return low;
}
function controls() {
  if (document.activeElement !== $("number")) $("number").value = number;
  $("prev").disabled = number === 1;
  $("next").disabled = number === pdf.numPages;
}
function report() {
  const entry = pages[number - 1];
  if (!entry) return;
  const offset = position();
  readingAnchor = { page: number, ...offset };
  parent.postMessage(
    {
      channel: "paseo-doc-view-state",
      view: {
        page: number,
        pdfZoom: scale,
        pdfFit: fit,
        scrollX: offset.x,
        scrollY: offset.y,
      },
    },
    "*",
  );
  if (!entry.rendered) return;
  parent.postMessage(
    {
      channel: "paseo-doc-ready",
      page: number,
      pages: pdf.numPages,
      textItems: entry.text?.childElementCount ?? 0,
      scale,
      fit,
      scrollHeight: scroll.scrollHeight,
      scrollViewport: scroll.clientHeight,
      scrollTop: scroll.scrollTop,
    },
    "*",
  );
}
function release(entry) {
  const job = entry.job;
  job?.renderTask?.cancel();
  job?.textTask?.cancel();
  entry.job = undefined;
  entry.rendered = false;
  entry.failed = false;
  if (entry.canvas) entry.canvas.width = entry.canvas.height = 0;
  entry.element.replaceChildren();
  entry.canvas = entry.text = undefined;
  if (!job) entry.page.cleanup();
}
async function renderText(entry, job, text, viewport) {
  try {
    job.textTask = new pdfjs.TextLayer({
      textContentSource: entry.page.streamTextContent(),
      container: text,
      viewport,
    });
    await job.textTask.render();
    if (entry.job === job && entry.number === number) report();
  } catch (error) {
    if (entry.job === job && error.name !== "AbortException")
      console.error("Could not render PDF text layer", error);
  } finally {
    if (entry.job === job) entry.job = undefined;
    // A cancelled text task may settle after the same page has started again.
    if (!entry.job && !entry.rendered) entry.page.cleanup();
  }
}
async function draw(entry) {
  const canvas = document.createElement("canvas"),
    text = document.createElement("div"),
    viewport = entry.page.getViewport({ scale }),
    ratio = Math.min(devicePixelRatio || 1, 2),
    job = {};
  entry.job = job;
  entry.canvas = canvas;
  entry.text = text;
  text.className = "textLayer";
  canvas.width = Math.ceil(viewport.width * ratio);
  canvas.height = Math.ceil(viewport.height * ratio);
  canvas.style.width = viewport.width + "px";
  canvas.style.height = viewport.height + "px";
  entry.element.replaceChildren(canvas, text);
  try {
    job.renderTask = entry.page.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    });
    await job.renderTask.promise;
    if (entry.job !== job) return;
    // Text extraction must not hold the canvas queue, including when this page
    // remains visible or cached next to the user's new reading page.
    entry.rendered = true;
    void renderText(entry, job, text, viewport);
    if (entry.number === number) report();
  } catch (error) {
    if (
      entry.job === job &&
      error.name !== "RenderingCancelledException" &&
      error.name !== "AbortException"
    ) {
      entry.failed = true;
      entry.element.textContent = error.message;
    }
  } finally {
    if (!entry.rendered && entry.job === job) entry.job = undefined;
    if (!entry.job && !entry.rendered) entry.page.cleanup();
  }
}
async function renderVisible() {
  if (drawing) return;
  drawing = true;
  try {
    while (!disposed) {
      const entry = visible.find((entry) => !entry.rendered && !entry.failed && !entry.job);
      if (!entry) break;
      await draw(entry);
    }
  } finally {
    drawing = false;
  }
}
function updateVisible() {
  if (disposed || !pages.length || pages.length !== pdf?.numPages || renderPending) return;
  if (scroll.clientWidth !== viewportWidth || scroll.clientHeight !== viewportHeight) {
    reflow();
    return;
  }
  const first = pageAt(scroll.scrollTop + gap),
    last = pageAt(scroll.scrollTop + scroll.clientHeight);
  number = first + 1;
  controls();
  // Visible pages first, then one neighbouring page on each side. Distant pages
  // keep their geometry but release their canvas, text layer and PDF resources.
  const start = Math.max(0, first - 1),
    end = Math.min(pages.length - 1, last + 1);
  visible = pages.slice(first, last + 1);
  if (start < first) visible.push(pages[start]);
  if (end > last) visible.push(pages[end]);
  for (const entry of pages)
    if ((entry.number < start + 1 || entry.number > end + 1) && (entry.canvas || entry.job))
      release(entry);
  report();
  void renderVisible();
}
function padEnd() {
  // Even a short final page must be able to reach the top reading margin.
  $("pages").style.paddingBottom =
    Math.max(0, scroll.clientHeight - (pages.at(-1)?.height ?? 0) - gap * 2) + "px";
}
function reflow() {
  // Resizing can clamp scrollTop before its scroll event or ResizeObserver runs.
  // Use the last reported reading anchor rather than that transient position.
  if (readingAnchor && !restoreScroll) {
    number = readingAnchor.page;
    restoreScroll = { ...readingAnchor };
  }
  layout();
}
function layout() {
  if (disposed || !pages.length || pages.length !== pdf?.numPages || scroll.clientWidth < 40) {
    renderPending = true;
    return;
  }
  renderPending = false;
  number = Math.max(1, Math.min(number, pages.length));
  const anchor = restoreScroll ?? position();
  restoreScroll = undefined;
  if (fit) {
    const widest = pages.reduce((width, entry) => Math.max(width, entry.width), 0);
    scale = Math.max(0.25, Math.min(2.5, (scroll.clientWidth - gap * 2) / widest));
  }
  const ratio = scale / anchor.scale;
  anchor.x *= ratio;
  anchor.y *= ratio;
  let top = gap;
  for (const entry of pages) {
    release(entry);
    entry.top = top;
    const viewport = entry.page.getViewport({ scale }),
      height = Math.ceil(viewport.height);
    entry.height = height;
    entry.element.style.width = viewport.width + "px";
    entry.element.style.height = height + "px";
    entry.element.style.setProperty("--scale-factor", scale);
    entry.element.style.setProperty("--total-scale-factor", scale);
    entry.element.style.setProperty("--user-unit", entry.page.userUnit || 1);
    top += height + gap;
  }
  $("zoom").textContent = Math.round(scale * 100) + "%";
  $("message").hidden = true;
  padEnd();
  const entry = pages[number - 1],
    y = Math.min(anchor.y, entry.height - 1);
  viewportWidth = scroll.clientWidth;
  viewportHeight = scroll.clientHeight;
  scroll.scrollTo(anchor.x, entry.top - gap + y);
  updateVisible();
}
function goToPage(value) {
  if (!pages.length || pages.length !== pdf?.numPages || renderPending) return;
  number = Math.max(1, Math.min(Math.trunc(value) || 1, pages.length));
  scroll.scrollTo(0, pages[number - 1].top - gap);
  $("number").value = number;
  updateVisible();
}
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.channel !== "paseo-doc-restore") return;
  const view = event.data.view;
  if (!view || typeof view !== "object") return;
  if (Number.isSafeInteger(view.page) && view.page > 0) number = view.page;
  if (Number.isFinite(view.pdfZoom) && view.pdfZoom >= 0.25 && view.pdfZoom <= 4)
    scale = view.pdfZoom;
  if (typeof view.pdfFit === "boolean") fit = view.pdfFit;
  if (Number.isFinite(view.scrollX) && Number.isFinite(view.scrollY))
    restoreScroll = { x: Math.max(0, view.scrollX), y: Math.max(0, view.scrollY), scale };
  if (pages.length === pdf?.numPages) layout();
});
parent.postMessage({ channel: "paseo-doc-initialized" }, "*");
scroll.addEventListener(
  "scroll",
  () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined;
      updateVisible();
    });
  },
  { passive: true },
);
const task = pdfjs.getDocument({
  data: decode(input.data),
  CMapReaderFactory: CMaps,
  StandardFontDataFactory: Fonts,
  WasmFactory: Wasm,
  useWorkerFetch: false,
  isEvalSupported: false,
  useSystemFonts: true,
});
task.onPassword = (update) => {
  $("password").hidden = false;
  $("unlock").onclick = () => {
    update($("secret").value);
    $("secret").value = "";
    $("password").hidden = true;
  };
};
task.promise
  .then(async (value) => {
    if (disposed) return;
    pdf = value;
    $("count").textContent = "/ " + pdf.numPages;
    $("number").max = pdf.numPages;
    // Read only page geometry up front, with bounded concurrency. This makes
    // jump/restore positions exact even for mixed page sizes and rotations.
    for (let start = 1; start <= pdf.numPages && !disposed; start += 8) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(8, pdf.numPages - start + 1) }, (_, i) =>
          pdf.getPage(start + i),
        ),
      );
      if (disposed) return;
      for (const page of batch) {
        const element = document.createElement("div"),
          n = pages.length + 1;
        element.className = "page";
        element.dataset.page = n;
        element.setAttribute("role", "region");
        element.setAttribute("aria-label", korean ? `${n}페이지` : `Page ${n}`);
        pages.push({
          page,
          number: n,
          width: page.getViewport({ scale: 1 }).width,
          element,
          top: 0,
        });
        $("pages").appendChild(element);
      }
    }
    layout();
  })
  .catch((error) => {
    if (disposed) return;
    $("message").hidden = false;
    $("message").textContent = tr("PDF를 열지 못했습니다. ") + error.message;
  });
$("prev").onclick = () => goToPage(number - 1);
$("next").onclick = () => goToPage(number + 1);
$("number").onchange = () => goToPage(Number($("number").value));
$("in").onclick = () => {
  restoreScroll = position();
  fit = false;
  scale = Math.min(4, scale + 0.2);
  layout();
};
$("out").onclick = () => {
  restoreScroll = position();
  fit = false;
  scale = Math.max(0.25, scale - 0.2);
  layout();
};
$("fit").onclick = () => {
  fit = true;
  layout();
};
let searching = false;
async function find() {
  const query = $("search").value.trim().toLocaleLowerCase();
  if (!query || !pdf || pages.length !== pdf.numPages || searching) return;
  searching = true;
  $("found").textContent = tr("찾는 중…");
  try {
    for (let offset = 1; offset <= pdf.numPages && !disposed; offset++) {
      const n = ((number - 1 + offset) % pdf.numPages) + 1,
        entry = pages[n - 1],
        content = await entry.page.getTextContent();
      if (!entry.canvas) entry.page.cleanup();
      if (
        content.items
          .map((i) => i.str || "")
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)
      ) {
        goToPage(n);
        $("found").textContent = korean ? `${n}페이지에서 찾음` : `Found on page ${n}`;
        return;
      }
    }
    $("found").textContent = tr("검색 결과 없음");
  } catch (error) {
    if (!disposed) $("found").textContent = error.message;
  } finally {
    searching = false;
  }
}
$("find").onclick = find;
$("search").onkeydown = (e) => {
  if (e.key === "Enter") find();
};
addEventListener("keydown", (e) => {
  if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    goToPage(number + (e.key === "ArrowRight" ? 1 : -1));
  }
  if (e.key === "PageDown" || e.key === "PageUp") {
    e.preventDefault();
    scroll.scrollBy(0, scroll.clientHeight * 0.9 * (e.key === "PageDown" ? 1 : -1));
  }
});
let resize;
const viewportObserver = new ResizeObserver(() => {
  clearTimeout(resize);
  resize = setTimeout(() => {
    if (
      renderPending ||
      scroll.clientWidth !== viewportWidth ||
      scroll.clientHeight !== viewportHeight
    )
      reflow();
  }, 120);
});
viewportObserver.observe(scroll);
addEventListener("pagehide", () => {
  disposed = true;
  viewportObserver.disconnect();
  clearTimeout(resize);
  cancelAnimationFrame(scrollFrame);
  for (const entry of pages) release(entry);
  task.destroy();
  URL.revokeObjectURL(worker);
  pending.clear();
});
