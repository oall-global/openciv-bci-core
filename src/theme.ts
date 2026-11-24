// 外观: dark (default), light or follow the system (design/dark-theme). The stylesheets switch
// through CSS variables (src/tokens.css, src/theme-colors.css); colours written in code
// (canvas charts, inline SVG) go through tc().
export type Theme = 'dark' | 'light' | 'system';
const KEY = 'neurolink.theme';
const media = window.matchMedia?.('(prefers-color-scheme: dark)');

export function savedTheme(): Theme {
  const t = localStorage.getItem(KEY);
  return t === 'light' || t === 'system' ? t : 'dark';
}
const resolve = (t: Theme) => (t === 'system' ? (media?.matches ? 'dark' : 'light') : t);
export const isDark = () => document.documentElement.dataset.theme === 'dark';

export function applyTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  document.documentElement.dataset.theme = resolve(t);
  cache.clear();
}
media?.addEventListener('change', () => {
  if (savedTheme() === 'system') applyTheme('system');
});

// A colour written for the light theme, as it should look on the dark one: light surfaces
// become dark, dark text and lines become light, coloured marks keep their hue (brighter).
const cache = new Map<string, string>();
function parse(c: string): [number, number, number, number] | null {
  const s = c.trim().toLowerCase();
  if (s === 'white') return [255, 255, 255, 1];
  if (s === 'black') return [0, 0, 0, 1];
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1,
    ];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const p = m[1].split(',').map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}
function hsl(r: number, g: number, b: number): [number, number, number] {
  ((r /= 255), (g /= 255), (b /= 255));
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min,
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function rgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12,
      a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}
export function tc(color: string): string {
  if (!isDark() || typeof color !== 'string') return color;
  const hit = cache.get(color);
  if (hit) return hit;
  const p = parse(color);
  let out = color;
  if (p) {
    const [r, g, b, a] = p;
    const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const [h, s] = hsl(r, g, b);
    let c: [number, number, number] | null = null;
    if (L > 0.9)
      c = [17, 23, 21]; // surface
    else if (L > 0.78)
      c = s < 0.15 ? [31, 41, 38] : rgb(h, Math.min(s, 0.4), 0.16); // grid, soft fills
    else if (L < 0.55)
      c = s < 0.18 ? (L < 0.3 ? [230, 238, 234] : [160, 175, 168]) : rgb(h, Math.min(1, s), 0.68);
    if (c) out = a < 1 ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})` : `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }
  cache.set(color, out);
  return out;
}

// Canvas charts draw with light-theme colours; map them when the dark theme is on. Canvases
// drawn for a dark background already (data-native) are left alone.
export function installCanvasTheme() {
  const proto = CanvasRenderingContext2D.prototype;
  for (const prop of ['strokeStyle', 'fillStyle'] as const) {
    const d = Object.getOwnPropertyDescriptor(proto, prop)!;
    Object.defineProperty(proto, prop, {
      configurable: true,
      get() {
        return d.get!.call(this);
      },
      set(v: unknown) {
        const native = (this.canvas as HTMLCanvasElement).dataset?.native !== undefined;
        d.set!.call(this, typeof v === 'string' && !native ? tc(v) : v);
      },
    });
  }
}
