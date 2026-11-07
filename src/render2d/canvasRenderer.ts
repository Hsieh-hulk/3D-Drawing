import type { Drawing, Pt2 } from '../projection/types';
import { cssFont, paintDrawing, type FontSpec, type Painter, type PxTransform, type RenderStyle, type StrokeSpec } from './paint';

export type { PxTransform, RenderStyle } from './paint';
export { DEFAULT_STYLE } from './paint';

/** Canvas 2D backend (on-screen view and PNG export). */
export class CanvasPainter implements Painter {
  constructor(private readonly ctx: CanvasRenderingContext2D) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  line(a: Pt2, b: Pt2, s: StrokeSpec): void {
    const ctx = this.ctx;
    ctx.globalAlpha = s.alpha;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.setLineDash(s.dash);
    ctx.lineWidth = s.width;
    ctx.strokeStyle = s.color;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  polygon(pts: Pt2[], color: string, alpha: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  circle(c: Pt2, r: number, fill: string | null, stroke: { color: string; width: number } | null, alpha: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.setLineDash([]);
      ctx.lineWidth = stroke.width;
      ctx.strokeStyle = stroke.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  text(str: string, x: number, yMid: number, font: FontSpec, color: string, halo: boolean): void {
    const ctx = this.ctx;
    ctx.font = cssFont(font);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (halo) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(str, x, yMid);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, yMid);
  }

  measure(str: string, font: FontSpec): number {
    this.ctx.font = cssFont(font);
    return this.ctx.measureText(str).width;
  }
}

export function drawDrawing(ctx: CanvasRenderingContext2D, drawing: Drawing, t: PxTransform, style: RenderStyle): void {
  paintDrawing(new CanvasPainter(ctx), drawing, t, style);
}
