import { HTML_BRIDGE } from "./html-bridge";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { load } from "cheerio";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

export const MAX_DOCUMENT = 64 * 1024 * 1024;
const MAX_HTML = 24 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
export function contained(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export async function safeFile(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const file = await realpath(resolve(base, path));
  if (!contained(base, file)) throw new Error("이 폴더 밖의 파일은 열 수 없습니다.");
  return file;
}
export async function boundedRead(file: string, max = MAX_DOCUMENT): Promise<Buffer> {
  const info = await stat(file);
  if (!info.isFile()) throw new Error("일반 파일만 열 수 있습니다.");
  if (info.size > max)
    throw new Error(
      `파일이 너무 큽니다. 최대 ${Math.round(max / 1024 / 1024)}MB까지 열 수 있습니다.`,
    );
  const data = await readFile(file);
  if (data.length > max) throw new Error("파일이 너무 큽니다.");
  return data;
}
export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
export function protectHtml(html: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">${html}`;
}

export async function prepareHtml(file: string): Promise<{ html: string; warnings: string[] }> {
  const root = await realpath(dirname(file));
  const warnings = new Set<string>();
  const cache = new Map<string, Buffer>();
  let total = 0;
  const asset = async (
    url: string,
    from: string,
  ): Promise<{ file: string; data: Buffer } | null> => {
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(url)) {
      if (url && !/^(?:data:|#)/i.test(url)) warnings.add("외부 리소스는 불러오지 않았습니다.");
      return null;
    }
    try {
      const path = await safeFile(
        root,
        relative(root, resolve(from, decodeURIComponent(url.split(/[?#]/)[0]))),
      );
      let data = cache.get(path);
      if (!data) {
        if (cache.size >= 256) throw new Error("리소스 수 제한");
        data = await boundedRead(path, 8 * 1024 * 1024);
        total += data.length;
        if (total > MAX_HTML) throw new Error("리소스 크기 제한");
        cache.set(path, data);
      }
      return { file: path, data };
    } catch {
      warnings.add("누락되었거나 문서 폴더 밖에 있는 리소스가 있습니다.");
      return null;
    }
  };
  const dataUrl = async (url: string, from: string) => {
    if (/^(data:|#)/i.test(url)) return url;
    const value = await asset(url, from);
    const mime = value && MIME[extname(value.file).toLowerCase()];
    return value && mime ? `data:${mime};base64,${value.data.toString("base64")}` : "";
  };
  const replaceAsync = async (
    text: string,
    pattern: RegExp,
    replace: (...args: string[]) => Promise<string>,
  ) => {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches.reverse())
      text =
        text.slice(0, match.index) +
        (await replace(...match)) +
        text.slice((match.index ?? 0) + match[0].length);
    return text;
  };
  const css = async (source: string, from: string, seen = new Set<string>()): Promise<string> => {
    let result = await replaceAsync(
      source,
      /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/gi,
      async (_whole, url) => {
        const value = await asset(url, from);
        if (!value || extname(value.file) !== ".css" || seen.has(value.file) || seen.size >= 8)
          return "";
        return css(
          value.data.toString("utf8"),
          dirname(value.file),
          new Set([...seen, value.file]),
        );
      },
    );
    result = await replaceAsync(
      result,
      /url\(\s*["']?([^)"']+)["']?\s*\)/gi,
      async (_whole, url) => `url("${await dataUrl(url.trim(), from)}")`,
    );
    return result;
  };
  const $ = load((await boundedRead(file, 8 * 1024 * 1024)).toString("utf8"));
  $("base, iframe, object, embed, meta[http-equiv]").remove();
  for (const element of $("link").toArray()) {
    const node = $(element);
    if ((node.attr("rel") ?? "").toLowerCase() === "stylesheet") {
      const value = await asset(node.attr("href") ?? "", root);
      if (value && extname(value.file).toLowerCase() === ".css")
        node.replaceWith(
          $("<style>").text(
            (await css(value.data.toString("utf8"), dirname(value.file))).replace(
              /<\/style/gi,
              "<\\/style",
            ),
          ),
        );
      else node.remove();
    } else node.remove();
  }
  for (const element of $("style").toArray()) $(element).text(await css($(element).text(), root));
  for (const element of $("[style]").toArray())
    $(element).attr("style", await css($(element).attr("style") ?? "", root));
  for (const element of $("img,source").toArray()) {
    const node = $(element);
    node.removeAttr("srcset");
    if (node.attr("src")) node.attr("src", await dataUrl(node.attr("src") ?? "", root));
  }
  for (const element of $("script[src]").toArray()) {
    const node = $(element);
    const url = node.attr("src") ?? "";
    if (/mathjax|katex/i.test(url)) {
      node.remove();
      continue;
    }
    const value = await asset(url, root);
    if (!value || !/\.(m?js)$/i.test(value.file) || node.attr("type") === "module") {
      node.remove();
      continue;
    }
    node
      .removeAttr("src")
      .removeAttr("integrity")
      .removeAttr("crossorigin")
      .text(value.data.toString("utf8").replace(/<\/script/gi, "<\\/script"));
  }
  const doc = mathjax.document($.html(), {
    InputJax: new TeX({
      packages: AllPackages.filter((name) => !["require", "autoload", "html"].includes(name)),
      inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"],
      ],
      displayMath: [
        ["$$", "$$"],
        ["\\[", "\\]"],
      ],
      processEscapes: true,
    }),
    OutputJax: new SVG({ fontCache: "none" }),
  });
  doc.render();
  const bridge = `<script>${HTML_BRIDGE}</script>`;
  const html = protectHtml(
    adaptor.outerHTML(adaptor.root(doc.document)).replace("</body>", () => bridge + "</body>"),
  );
  if (Buffer.byteLength(html) > MAX_DOCUMENT) throw new Error("미리보기 리소스가 너무 큽니다.");
  return { html, warnings: [...warnings] };
}
