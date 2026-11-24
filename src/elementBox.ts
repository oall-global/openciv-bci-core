// An element's size, measured once and then kept up to date by a ResizeObserver. Reading
// getBoundingClientRect every animation frame forces a layout whenever anything on the page
// changed since (labels, numbers): on the 主图 that was a fifth of every frame.
const boxes = new WeakMap<Element, { width: number; height: number }>();
const watch = new ResizeObserver((entries) => {
  for (const e of entries)
    boxes.set(e.target, { width: e.contentRect.width, height: e.contentRect.height });
});
export function boxOf(el: Element) {
  let b = boxes.get(el);
  if (!b) {
    const r = el.getBoundingClientRect();
    boxes.set(el, (b = { width: r.width, height: r.height }));
    watch.observe(el);
  }
  return b;
}
