Document viewer opens local HTML and PDF files in a Paseo workspace tab. It connects the existing file tree to that tab and also provides a Documents sidebar button and file chooser.

HTML previews include local styles, images, fonts and classic scripts from the document folder. LaTeX is rendered locally into SVG. The toolbar provides 50–300% zoom and a reset button without reloading the page. Relative PDF links preserve their page anchors. PDF previews provide page navigation, zoom, fit width, selectable text, search and password entry.

The daemon host needs Paseo 0.11.2–0.11.x, Node.js 22.22 or later and npm. Setup downloads pinned dependencies and prepares PDF resources, without downloading a browser or opening another HTTP port. Controls are available in English and Korean. Previews run on desktop and web; native mobile clients show an availability notice.

The plugin reads selected files in the current workspace. HTML assets are restricted to the document folder after resolving symlinks. Documents use an isolated iframe with external requests blocked; inline scripts run, and browser policy cannot completely prevent frame self-navigation. Document contents are not stored in browser storage or sent to third-party services. PDF files are limited to 64 MiB. Remote CDN content, API-dependent pages and ES modules are not supported.

Paseo 0.11 has no public file-preview replacement API, so the existing file-tree connection uses a version-scoped DOM adapter. The independent file chooser remains available if the app's tree layout changes.
