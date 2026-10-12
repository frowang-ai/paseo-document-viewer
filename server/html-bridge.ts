// This runs only in the opaque document frame, never in the Paseo app realm.
export const HTML_BRIDGE = String.raw`
(() => {
  let zoom = 1;
  let pendingScroll;
  const restoreScroll = () => {
    if (!pendingScroll || !innerWidth || !innerHeight) return;
    scrollTo(pendingScroll.x,pendingScroll.y);pendingScroll=undefined;
  };
  const applyZoom = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    zoom = Math.round(Math.min(3, Math.max(0.5, value)) * 10) / 10;
    document.documentElement.style.zoom = String(zoom);
    parent.postMessage({channel:'paseo-doc-zoom-state',scale:zoom},'*');
  };
  addEventListener('message', event => {
    if(event.source === parent && event.data?.channel === 'paseo-doc-zoom') applyZoom(event.data.scale);
    if(event.source === parent && event.data?.channel === 'paseo-doc-restore') {
      const view=event.data.view;if(!view)return;
      applyZoom(view.htmlZoom);
      if(Number.isFinite(view.scrollX)&&Number.isFinite(view.scrollY)) {
        pendingScroll={x:Math.max(0,view.scrollX),y:Math.max(0,view.scrollY)};
        requestAnimationFrame(restoreScroll);
      }
    }
  });
  addEventListener('resize',()=>requestAnimationFrame(restoreScroll));
  addEventListener('scroll',()=>{
    parent.postMessage({channel:'paseo-doc-view-state',view:{scrollX,scrollY}},'*');
  },{passive:true});
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || /INPUT|TEXTAREA/.test(event.target.tagName)) return;
    if (['+','=','-','0'].includes(event.key)) {
      event.preventDefault();
      applyZoom(event.key === '0' ? 1 : zoom + (event.key === '-' ? -0.1 : 0.1));
    }
  });
  addEventListener('load', () => parent.postMessage({
    channel:'paseo-doc-html-ready',
    images:[...document.images].filter(i=>i.complete&&i.naturalWidth>0).length,
    total:document.images.length,
    math:document.querySelectorAll('mjx-container').length,
    margin:getComputedStyle(document.body).margin,
    background:getComputedStyle(document.body).backgroundColor
  },'*'));
  document.addEventListener('click',event=>{
    const a=event.target.closest('a[href]');if(!a)return;
    const href=a.getAttribute('href');
    if(/\.(?:pdf|html?)(?:#page=[1-9]\d*)?$/i.test(href)&&!/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href)){
      event.preventDefault();parent.postMessage({channel:'paseo-doc-open',href},'*');
    }
  });
})();
`;
