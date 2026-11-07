import type { ArrowPrim, Drawing, LabelPrim, LinePrim, PointPrim, PolygonPrim, Pt2, TickPrim } from '../projection/types';

/**
 * Backend-neutral painting. The layering, sizes and label layout live here once; the canvas (screen + PNG),
 * SVG and PDF backends only implement these few primitives, so every output looks the same.
 */

export interface FontSpec {
  /** CSS font-family list (canvas / SVG). */
  family: string;
  /** Generic class, used by the PDF backend to pick a standard font. */
  generic: 'serif' | 'sans';
  size: number;
  italic: boolean;
  weight: number;
}

export interface StrokeSpec {
  color: string;
  width: number;
  dash: number[];
  alpha: number;
}

export interface Painter {
  line(a: Pt2, b: Pt2, s: StrokeSpec): void;
  polygon(pts: Pt2[], color: string, alpha: number): void;
  circle(c: Pt2, r: number, fill: string | null, stroke: { color: string; width: number } | null, alpha: number): void;
  /** Draws text with its left edge at x and its vertical centre at yMid. `halo` adds a white outline. */
  text(str: string, x: number, yMid: number, font: FontSpec, color: string, halo: boolean): void;
  measure(str: string, font: FontSpec): number;
}

/** Maps drawing space (world units, y up) to output pixels (y down). */
export interface PxTransform {
  scale: number;
  /** Drawing-space point that lands on (cx, cy). */
  origin: Pt2;
  cx: number;
  cy: number;
}

export interface RenderStyle {
  showHiddenLines: boolean;
  /** Multiplies every stroke width (export can thicken lines for handwriting notes). */
  lineScale: number;
  /** Multiplies every font size. */
  fontScale: number;
}

export const DEFAULT_STYLE: RenderStyle = { showHiddenLines: true, lineScale: 1, fontScale: 1 };
export const SELECT_COLOR = '#2f6fd6';

const SERIF = '"Times New Roman", "Cambria Math", "STIX Two Math", serif';
const SANS = 'system-ui, -apple-system, "PingFang TC", "Noto Sans TC", Helvetica, Arial, sans-serif';

const LINE_WIDTH: Record<LinePrim['role'], number> = {
  grid: 1,
  axis: 1.4,
  'plane-edge': 1.4,
  edge: 2,
  segment: 2,
  vector: 2.5,
  guide: 1,
};

const LABEL_FONTS: Record<LabelPrim['style'], Omit<FontSpec, 'size'> & { size: number }> = {
  point: { family: SERIF, generic: 'serif', size: 19, italic: true, weight: 600 },
  vector: { family: SERIF, generic: 'serif', size: 18, italic: true, weight: 600 },
  axis: { family: SERIF, generic: 'serif', size: 20, italic: true, weight: 600 },
  origin: { family: SERIF, generic: 'serif', size: 16, italic: true, weight: 400 },
  tick: { family: SANS, generic: 'sans', size: 11, italic: false, weight: 400 },
};

export function labelFont(style: LabelPrim['style'], fontScale: number): FontSpec {
  const f = LABEL_FONTS[style];
  return { ...f, size: f.size * fontScale };
}

export function subFont(fontScale: number): FontSpec {
  return { family: SANS, generic: 'sans', size: 13 * fontScale, italic: false, weight: 400 };
}

export function cssFont(f: FontSpec): string {
  return `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px ${f.family}`;
}

const lineWidthOf = (l: LinePrim, k: number) => (LINE_WIDTH[l.role] + (l.selected ? 1.5 : 0)) * k;
const dashOf = (l: LinePrim, k: number) => (l.role === 'guide' ? [3 * k, 3 * k] : [6 * k, 4 * k]);

export function toPx(t: PxTransform, p: Pt2): Pt2 {
  return [t.cx + (p[0] - t.origin[0]) * t.scale, t.cy - (p[1] - t.origin[1]) * t.scale];
}

/** Pulls the `b` end back by `trim` px, unless the line is too short to trim safely. */
export function trimmed(a: Pt2, b: Pt2, trim = 0): [Pt2, Pt2] {
  if (!trim) return [a, b];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < trim * 1.5) return [a, b];
  const k = (len - trim) / len;
  return [a, [a[0] + dx * k, a[1] + dy * k]];
}

/** Arrowhead triangle in px (y down). `dir` is in drawing space (y up). */
export function arrowPolygon(tip: Pt2, dir: Pt2, role: ArrowPrim['role'], selected: boolean, k: number): Pt2[] {
  const grow = selected ? 1.15 : 1;
  const len = (role === 'vector' ? 13 : 10) * k * grow;
  const half = (role === 'vector' ? 5 : 3.8) * k * grow;
  const ux = dir[0];
  const uy = -dir[1];
  const bx = tip[0] - ux * len;
  const by = tip[1] - uy * len;
  return [tip, [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]];
}

export interface LabelLayout {
  /** Left edge of the whole label and its vertical centre, in px. */
  left: number;
  y: number;
  mainWidth: number;
  totalWidth: number;
  height: number;
}

export function layoutLabel(measure: Painter['measure'], l: LabelPrim, at: Pt2, fontScale: number): LabelLayout {
  const main = labelFont(l.style, fontScale);
  const mainWidth = measure(l.text, main);
  const subWidth = l.sub ? measure(l.sub, subFont(fontScale)) + 2 * fontScale : 0;
  const totalWidth = mainWidth + subWidth;
  const ox = l.offsetPx[0] * fontScale;
  const oy = l.offsetPx[1] * fontScale;
  const len = Math.hypot(ox, oy) || 1;
  // Wide labels (with coordinates) are pushed further out horizontally so they never cover the point.
  const extra = l.sub ? Math.abs(ox / len) * (totalWidth / 2 - mainWidth / 2) : 0;
  const cx = at[0] + ox + (ox / len) * extra;
  return { left: cx - totalWidth / 2, y: at[1] - oy, mainWidth, totalWidth, height: main.size * 1.25 };
}

/** Paints a drawing with the shared layering rules. */
export function paintDrawing(p: Painter, drawing: Drawing, t: PxTransform, style: RenderStyle): void {
  const k = style.lineScale;
  const px = (q: Pt2) => toPx(t, q);
  const lines = drawing.prims.filter((q): q is LinePrim => q.type === 'line');
  const polys = drawing.prims.filter((q): q is PolygonPrim => q.type === 'polygon').sort((a, b) => b.depth - a.depth);

  // 1. grid
  for (const l of lines) if (l.role === 'grid') p.line(px(l.a), px(l.b), { color: l.color, width: lineWidthOf(l, k), dash: [], alpha: 1 });

  // 2. translucent planes, far to near
  for (const poly of polys) p.polygon(poly.pts.map(px), poly.color, poly.opacity);

  // 3. hidden (dashed) lines and guides
  for (const l of lines) {
    if (l.role === 'grid' || !l.hidden) continue;
    if (!style.showHiddenLines && l.role !== 'guide') continue;
    const [a, b] = trimmed(px(l.a), px(l.b), l.trimEndPx);
    const guide = l.role === 'guide';
    p.line(a, b, { color: l.color, width: lineWidthOf(l, k) * (guide ? 1 : 0.85), dash: dashOf(l, k), alpha: guide ? 0.9 : 0.85 });
  }

  // 4. selection halos, then visible lines by role
  for (const l of lines) {
    if (l.role === 'grid' || l.hidden || !l.selected) continue;
    const [a, b] = trimmed(px(l.a), px(l.b), l.trimEndPx);
    p.line(a, b, { color: SELECT_COLOR, width: lineWidthOf(l, k) + 6, dash: [], alpha: 0.22 });
  }
  for (const role of ['axis', 'plane-edge', 'edge', 'segment', 'vector'] as const) {
    for (const l of lines) {
      if (l.role !== role || l.hidden) continue;
      const [a, b] = trimmed(px(l.a), px(l.b), l.trimEndPx);
      p.line(a, b, { color: l.color, width: lineWidthOf(l, k), dash: [], alpha: 1 });
    }
  }

  // 5. axis ticks
  for (const tk of drawing.prims.filter((q): q is TickPrim => q.type === 'tick')) {
    const [x, y] = px(tk.p);
    const dx = tk.across[0] * 4 * k;
    const dy = -tk.across[1] * 4 * k;
    p.line([x - dx, y - dy], [x + dx, y + dy], { color: tk.color, width: 1.2 * k, dash: [], alpha: 1 });
  }

  // 6. arrowheads
  for (const a of drawing.prims.filter((q): q is ArrowPrim => q.type === 'arrow')) {
    if (a.hidden && !style.showHiddenLines) continue;
    p.polygon(arrowPolygon(px(a.tip), a.dir, a.role, a.selected ?? false, k), a.color, a.hidden ? 0.55 : 1);
  }

  // 7. points (hidden points are hollow)
  for (const pt of drawing.prims.filter((q): q is PointPrim => q.type === 'point')) {
    const c = px(pt.p);
    const r = (pt.selected ? 5 : 3.5) * k;
    if (pt.selected) p.circle(c, r + 5, SELECT_COLOR, null, 0.2);
    if (pt.hidden) p.circle(c, r, '#ffffff', { color: pt.color, width: 1.5 * k }, 1);
    else p.circle(c, r, pt.color, null, 1);
  }

  // 8. labels
  for (const l of drawing.prims.filter((q): q is LabelPrim => q.type === 'label')) paintLabel(p, l, px(l.p), style.fontScale);
}

function paintLabel(p: Painter, l: LabelPrim, at: Pt2, fs: number): void {
  const lay = layoutLabel((s, f) => p.measure(s, f), l, at, fs);
  const color = l.selected ? SELECT_COLOR : l.color;
  p.text(l.text, lay.left, lay.y, labelFont(l.style, fs), color, true);

  if (l.style === 'vector') {
    // Arrow above the vector name, as written in textbooks.
    const y = lay.y - labelFont('vector', fs).size * 0.62;
    const x0 = lay.left + 1;
    const x1 = lay.left + lay.mainWidth + 1;
    p.line([x0, y], [x1 - 2, y], { color, width: 1.4 * fs, dash: [], alpha: 1 });
    p.polygon(
      [
        [x1 + 1, y],
        [x1 - 5 * fs, y - 3 * fs],
        [x1 - 5 * fs, y + 3 * fs],
      ],
      color,
      1,
    );
  }
  if (l.sub) p.text(l.sub, lay.left + lay.mainWidth + 2 * fs, lay.y + 1, subFont(fs), l.color, true);
}

export interface PxBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Pixel extent of everything `paintDrawing` would paint (geometry + labels + arrowheads), for cropping exports. */
export function paintedBounds(measure: Painter['measure'], drawing: Drawing, t: PxTransform, style: RenderStyle): PxBox {
  const box: PxBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number, pad = 0) => {
    box.minX = Math.min(box.minX, x - pad);
    box.maxX = Math.max(box.maxX, x + pad);
    box.minY = Math.min(box.minY, y - pad);
    box.maxY = Math.max(box.maxY, y + pad);
  };
  const k = style.lineScale;
  for (const pr of drawing.prims) {
    switch (pr.type) {
      case 'line': {
        if (pr.hidden && !style.showHiddenLines && pr.role !== 'guide') break;
        const [a, b] = [toPx(t, pr.a), toPx(t, pr.b)];
        add(a[0], a[1], 2 * k);
        add(b[0], b[1], 2 * k);
        break;
      }
      case 'polygon':
        pr.pts.forEach((q) => add(...toPx(t, q)));
        break;
      case 'arrow':
        add(...toPx(t, pr.tip), 6 * k);
        break;
      case 'tick':
        add(...toPx(t, pr.p), 5 * k);
        break;
      case 'point':
        add(...toPx(t, pr.p), 6 * k);
        break;
      case 'label': {
        const lay = layoutLabel(measure, pr, toPx(t, pr.p), style.fontScale);
        add(lay.left - 2, lay.y - lay.height / 2 - (pr.style === 'vector' ? 6 : 0));
        add(lay.left + lay.totalWidth + 2, lay.y + lay.height / 2);
        break;
      }
    }
  }
  if (!Number.isFinite(box.minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return box;
}
