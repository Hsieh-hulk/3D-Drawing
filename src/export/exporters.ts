import { CanvasPainter } from '../render2d/canvasRenderer';
import { paintDrawing, type FontSpec, cssFont } from '../render2d/paint';
import type { ExportFormat, ExportFrame, ExportOptions } from './frame';
import { frameToPdf } from './pdf';
import { frameToSvg } from './svg';

const MAX_PNG_SIDE = 8192;

let measureCtx: CanvasRenderingContext2D | null = null;
/** Text measurement shared by every backend, so label layout is identical in PNG, SVG and PDF. */
export function measureText(str: string, font: FontSpec): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = cssFont(font);
  return measureCtx.measureText(str).width;
}

/** Renders the frame on a canvas at `scale`× resolution. */
export function renderFrameToCanvas(frame: ExportFrame, scale: number, background: string | null): HTMLCanvasElement {
  const k = Math.min(scale, MAX_PNG_SIDE / Math.max(frame.width, frame.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width * k));
  canvas.height = Math.max(1, Math.round(frame.height * k));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, frame.width, frame.height);
  }
  paintDrawing(new CanvasPainter(ctx), frame.drawing, frame.transform, frame.style);
  return canvas;
}

export async function exportBlob(frame: ExportFrame, opts: ExportOptions): Promise<Blob> {
  const background = opts.transparent ? null : '#ffffff';
  switch (opts.format) {
    case 'png': {
      const canvas = renderFrameToCanvas(frame, opts.pngScale, background);
      return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 產生失敗'))), 'image/png'),
      );
    }
    case 'svg':
      return new Blob([frameToSvg(frame, measureText, background)], { type: 'image/svg+xml' });
    case 'pdf':
      // PDF pages are opaque white by convention; "transparent" only skips the explicit fill.
      return new Blob([frameToPdf(frame, measureText, background)], { type: 'application/pdf' });
  }
}

export const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True when the browser can hand files to the system share sheet (iPad → GoodNotes). Needs HTTPS or localhost. */
export function canShareFiles(): boolean {
  try {
    const probe = new File(['x'], 'probe.png', { type: 'image/png' });
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

export type ShareResult = 'shared' | 'cancelled';

export async function shareBlob(blob: Blob, filename: string, format: ExportFormat): Promise<ShareResult> {
  const file = new File([blob], filename, { type: MIME[format] });
  try {
    await navigator.share({ files: [file], title: filename });
    return 'shared';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    throw err;
  }
}
