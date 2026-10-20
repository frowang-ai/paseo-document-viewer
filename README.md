# Document viewer for Paseo

This checkout contains a small Paseo 0.12 compatibility patch to [no-carve-only-pizza/paseo-document-viewer](https://github.com/no-carve-only-pizza/paseo-document-viewer). The original implementation, license and attribution are retained.

Read local HTML and PDF files in a Paseo workspace tab. Open a document from the existing file tree, the Documents sidebar button, or the Command Center.

![Document viewer panel preview with the bundled HTML demo](assets/preview.png)

Standalone preview of the shipped panel component, using the bundled sample files.

## Install

This modified checkout supports **Paseo 0.11.2–0.12.x** on both the daemon and the client, including a 0.11.x daemon with a 0.12.x client. The daemon host needs Node.js 22.22 or later and npm.

Prepare and install this directory on the daemon host:

```sh
node scripts/prepare.mjs
paseo plugin install /absolute/path/to/paseo-document-viewer
```

You can also paste that directory path into Settings → Plugins. The upstream `v0.3.0` Git release still excludes Paseo 0.12; use this modified directory for 0.12 support. Preparation downloads the locked npm dependencies and prepares the PDF engine. No extra Chromium download or separate web server is needed.

Connected desktop and web clients load the viewer from the selected daemon. PDF files are read from that host's workspace and transferred through the existing Paseo connection; the viewing computer does not need another plugin installation.

## Use

- Click an HTML or PDF file in the file tree. Each file opens in its own workspace tab beside agents and terminals. Opening the same file again focuses its existing tab.
- For HTML, use **− / percentage / +** to zoom from **50% to 300%**. Clicking the percentage resets it to 100%. Ctrl/Cmd with +, − or 0 also works while the document has focus. Zoom does not reload the document.
- HTML styles, images, fonts and classic scripts are included from the document's own folder. LaTeX is rendered locally as SVG. Relative links to PDF files preserve `#page=N`.
- For PDF, use page navigation, zoom, fit width, text selection and search. Passwords are used only to open the document and are not saved.
- Choose file opens a folder browser and opens the chosen file in another tab. Reload reads the current file again. Page, zoom and scroll position are kept separately for every file, including after closing and reopening its tab or reloading the app.

Controls use English or Korean according to the browser/system language. See [한국어 안내](README.ko.md).

## Limits and privacy

Desktop and web previews are supported. Native iOS and Android show a notice instead of rendering documents. The current implementation was checked on macOS; CI checks the build and regression tests on Linux.

The existing file-tree connection uses a DOM adapter shared by Paseo 0.11 and 0.12, which have no public file-preview replacement API. The standalone Documents panel remains available if that layout changes. The manifest is capped below Paseo 0.13 so later API changes can be checked before enabling them.

HTML resources must resolve inside the document folder, including after resolving symlinks. Remote CDNs, API-dependent pages and ES modules are not loaded. PDF files up to 64 MiB are supported. PDF resources are prepared locally and delivered through Paseo's existing connection.

Documents run in an opaque-origin iframe. Inline scripts can run, but cannot read the Paseo parent DOM, cookies or storage. External resource requests, forms and nested frames are blocked. As with Paseo's built-in preview, browser policy cannot completely prevent a document from navigating its own frame. There is no telemetry or analytics.

Paseo manages tab placement and closing. The plugin saves up to 128 recent document paths and their reading positions in this client's browser storage, scoped by host and workspace. Document contents and PDF passwords are not saved there.

## Support

If you find this plugin useful, you can [support its development on GitHub Sponsors](https://github.com/sponsors/no-carve-only-pizza). One-time and monthly sponsorships start at $1, and you can choose your own amount.

## Development

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
npm run lint
npm run format:check
```

Build prepares relocatable PDF resources from the pinned dependency tree. Generated assets contain no installation-specific paths. The example documents are in `examples/`; their contents are synthetic.

This project is Apache-2.0 licensed. Third-party notices are in `NOTICE` and `licenses/`.
