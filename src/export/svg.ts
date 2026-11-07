import type { Pt2 } from '../projection/types';
import { paintDrawing, type FontSpec, type Painter, type StrokeSpec } from '../render2d/paint';
import type { ExportFrame } from './frame';

const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** SVG backend: emits one element per painted primitive. */
export class SvgPainter implements Painter {
  readonly parts: string[] = [];
  constructor(private readonly measureFn: Painter['measure']) {}

  line(a: Pt2, b: Pt2, s: StrokeSpec): void {
    const dash = s.dash.length ? ` stroke-dasharray="${s.dash.map(n).join(' ')}"` : '';
    const op = s.alpha < 1 ? ` stroke-opacity="${n(s.alpha)}"` : '';
    this.parts.push(
      `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${s.color}" stroke-width="${n(s.width)}"${dash}${op}/>`,
    );
  }

  polygon(pts: Pt2[], color: string, alpha: number): void {
    const op = alpha < 1 ? ` fill-opacity="${n(alpha)}"` : '';
    this.parts.push(`<polygon points="${pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" fill="${color}"${op}/>`);
  }

  circle(c: Pt2, r: number, fill: string | null, stroke: { color: string; width: number } | null, alpha: number): void {
    const st = stroke ? ` stroke="${stroke.color}" stroke-width="${n(stroke.width)}"` : '';
    const op = alpha < 1 ? ` opacity="${n(alpha)}"` : '';
    this.parts.push(`<circle cx="${n(c[0])}" cy="${n(c[1])}" r="${n(r)}" fill="${fill ?? 'none'}"${st}${op}/>`);
  }

  text(str: string, x: number, yMid: number, font: FontSpec, color: string, halo: boolean): void {
    const style = `font-family="${escapeXml(font.family)}" font-size="${n(font.size)}"${font.italic ? ' font-style="italic"' : ''} font-weight="${font.weight}"`;
    const haloAttr = halo ? ' stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke"' : '';
    this.parts.push(
      `<text x="${n(x)}" y="${n(yMid)}" dominant-baseline="central" ${style} fill="${color}"${haloAttr}>${escapeXml(str)}</text>`,
    );
  }

  measure(str: string, font: FontSpec): number {
    return this.measureFn(str, font);
  }
}

export function frameToSvg(frame: ExportFrame, measure: Painter['measure'], background: string | null): string {
  const p = new SvgPainter(measure);
  paintDrawing(p, frame.drawing, frame.transform, frame.style);
  const bg = background ? `<rect width="100%" height="100%" fill="${background}"/>` : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" stroke-linecap="round" stroke-linejoin="round">`,
    bg,
    ...p.parts,
    '</svg>',
  ].join('\n');
}
