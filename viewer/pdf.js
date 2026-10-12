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
let pdf,
  number = input.page,
  scale = 1,
  fit = true,
  renderTask,
  textTask,
  restoreScroll,
  lastRenderedPage,
  renderPending = false,
  revision = 0;
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.channel !== "paseo-doc-restore") return;
  const view = event.data.view;
  if (!view || typeof view !== "object") return;
  if (Number.isSafeInteger(view.page) && view.page > 0) number = view.page;
  if (Number.isFinite(view.pdfZoom) && view.pdfZoom >= 0.25 && view.pdfZoom <= 4)
    scale = view.pdfZoom;
  if (typeof view.pdfFit === "boolean") fit = view.pdfFit;
  if (Number.isFinite(view.scrollX) && Number.isFinite(view.scrollY))
    restoreScroll = { x: Math.max(0, view.scrollX), y: Math.max(0, view.scrollY) };
  if (pdf) render();
});
parent.postMessage({ channel: "paseo-doc-initialized" }, "*");
$("scroll").addEventListener(
  "scroll",
  () => {
    parent.postMessage(
      {
        channel: "paseo-doc-view-state",
        view: {
          scrollX: $("scroll").scrollLeft,
          scrollY: $("scroll").scrollTop,
        },
      },
      "*",
    );
  },
  { passive: true },
);
async function render() {
  if (!pdf || $("scroll").clientWidth < 40) {
    renderPending = true;
    return;
  }
  renderPending = false;
  const rev = ++revision;
  renderTask?.cancel();
  textTask?.cancel();
  number = Math.max(1, Math.min(number, pdf.numPages));
  $("number").value = number;
  $("prev").disabled = number === 1;
  $("next").disabled = number === pdf.numPages;
  try {
    const page = await pdf.getPage(number);
    if (rev !== revision) return;
    const width = page.getViewport({ scale: 1 }).width;
    if (fit) scale = Math.max(0.25, Math.min(2.5, ($("scroll").clientWidth - 40) / width));
    const viewport = page.getViewport({ scale }),
      ratio = Math.min(devicePixelRatio || 1, 2),
      canvas = document.querySelector("canvas"),
      container = $("page");
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    container.style.width = viewport.width + "px";
    container.style.height = viewport.height + "px";
    container.style.setProperty("--scale-factor", scale);
    container.style.setProperty("--total-scale-factor", scale);
    container.style.setProperty("--user-unit", page.userUnit || 1);
    $("zoom").textContent = Math.round(scale * 100) + "%";
    $("message").hidden = true;
    renderTask = page.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    });
    await renderTask.promise;
    if (rev !== revision) return;
    const text = document.querySelector(".textLayer");
    text.replaceChildren();
    textTask = new pdfjs.TextLayer({
      textContentSource: await page.getTextContent(),
      container: text,
      viewport,
    });
    await textTask.render();
    if (restoreScroll) {
      $("scroll").scrollTo(restoreScroll.x, restoreScroll.y);
      restoreScroll = undefined;
    } else if (lastRenderedPage !== number) $("scroll").scrollTo(0, 0);
    lastRenderedPage = number;
    container.dataset.page = number;
    parent.postMessage(
      {
        channel: "paseo-doc-ready",
        page: number,
        pages: pdf.numPages,
        textItems: text.childElementCount,
        scale,
        fit,
        scrollHeight: $("scroll").scrollHeight,
        scrollViewport: $("scroll").clientHeight,
        scrollTop: $("scroll").scrollTop,
      },
      "*",
    );
  } catch (error) {
    if (error.name !== "RenderingCancelledException" && error.name !== "AbortException") {
      $("message").hidden = false;
      $("message").textContent = error.message;
    }
  }
}
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
  .then((value) => {
    pdf = value;
    $("count").textContent = "/ " + pdf.numPages;
    $("number").max = pdf.numPages;
    render();
  })
  .catch((error) => {
    $("message").textContent = tr("PDF를 열지 못했습니다. ") + error.message;
  });
$("prev").onclick = () => {
  number--;
  render();
};
$("next").onclick = () => {
  number++;
  render();
};
$("number").onchange = () => {
  number = Number($("number").value) || 1;
  render();
};
$("in").onclick = () => {
  fit = false;
  scale = Math.min(4, scale + 0.2);
  render();
};
$("out").onclick = () => {
  fit = false;
  scale = Math.max(0.25, scale - 0.2);
  render();
};
$("fit").onclick = () => {
  fit = true;
  render();
};
let searching = false;
async function find() {
  const query = $("search").value.trim().toLocaleLowerCase();
  if (!query || !pdf || searching) return;
  searching = true;
  $("found").textContent = tr("찾는 중…");
  try {
    for (let offset = 1; offset <= pdf.numPages; offset++) {
      const n = ((number - 1 + offset) % pdf.numPages) + 1;
      const page = await pdf.getPage(n),
        content = await page.getTextContent();
      if (
        content.items
          .map((i) => i.str || "")
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)
      ) {
        number = n;
        await render();
        $("found").textContent = korean ? `${n}페이지에서 찾음` : `Found on page ${n}`;
        return;
      }
    }
    $("found").textContent = tr("검색 결과 없음");
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
  if (["PageDown", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    number++;
    render();
  }
  if (["PageUp", "ArrowLeft"].includes(e.key)) {
    e.preventDefault();
    number--;
    render();
  }
});
let resize;
addEventListener("resize", () => {
  clearTimeout(resize);
  resize = setTimeout(() => {
    if (fit || renderPending) render();
  }, 120);
});
const viewportObserver = new ResizeObserver(() => {
  if (renderPending) render();
});
viewportObserver.observe($("scroll"));
addEventListener("pagehide", () => {
  viewportObserver.disconnect();
  renderTask?.cancel();
  textTask?.cancel();
  task.destroy();
  URL.revokeObjectURL(worker);
  pending.clear();
});
