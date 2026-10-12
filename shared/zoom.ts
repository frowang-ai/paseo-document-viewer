export const MIN_HTML_ZOOM = 0.5;
export const MAX_HTML_ZOOM = 3;
export function nextHtmlZoom(current: number, change: number) {
  return Math.round(Math.max(MIN_HTML_ZOOM, Math.min(MAX_HTML_ZOOM, current + change)) * 10) / 10;
}
