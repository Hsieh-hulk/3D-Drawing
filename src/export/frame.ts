import { coordsValue, vectorEndpoints, type Scene } from '../model/scene';
import type { ViewSettings } from '../model/types';
import { projectToDrawing } from '../projection/project';
import type { Drawing, ViewCamera } from '../projection/types';
import { paintedBounds, type Painter, type PxTransform, type RenderStyle } from '../render2d/paint';

export type ExportFormat = 'png' | 'pdf' | 'svg';

export interface ExportOptions {
  format: ExportFormat;
  pngScale: 1 | 2 | 4;
  transparent: boolean;
  showAxes: boolean;
  showGrid: boolean;
  showTickLabels: boolean;
  showHiddenLines: boolean;
  lineScale: number;
  fontScale: number;
  /** Shorten the axes (and grid) to just beyond the objects, so small figures are not dwarfed by ±5 axes. */
  fitAxes: boolean;
  /** Coordinates next to point names; omitted = same as on screen. */
  showPointCoords?: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'png',
  pngScale: 2,
  transparent: true,
  showAxes: true,
  showGrid: false,
  showTickLabels: true,
  showHiddenLines: true,
  lineScale: 1,
  fontScale: 1,
  fitAxes: true,
};

/** Smallest integer axis range that still contains every object (plus one unit), within [2, max]. */
export function fittedAxisRange(scene: Scene, max: number): number {
  let extent = 0;
  const grow = (p: readonly number[]) => {
    for (const v of p) extent = Math.max(extent, Math.abs(v));
  };
  for (const o of scene.objects) {
    if (!o.visible) continue;
    // A curve or surface fills the whole axis box, so shrinking the range would clip or drop it.
    if (o.kind === 'equation') extent = max;
    if (o.kind === 'point') grow(coordsValue(o.coords));
    if (o.kind === 'vector') {
      const e = vectorEndpoints(scene, o);
      if (e) {
        grow(e.start);
        grow(e.end);
      }
    }
  }
  return Math.max(2, Math.min(max, Math.ceil(extent - 1e-9) + 1));
}

/** Everything a backend needs to paint one export, in output pixels (CSS px at 1×). */
export interface ExportFrame {
  width: number;
  height: number;
  transform: PxTransform;
  drawing: Drawing;
  style: RenderStyle;
}

const MARGIN_PX = 16;

/**
 * Re-projects the scene with the export toggles (selection never exported) and crops the page to the
 * painted content plus a margin.
 */
export function buildExportFrame(
  scene: Scene,
  cam: ViewCamera,
  view: ViewSettings,
  opts: ExportOptions,
  pxPerUnit: number,
  measure: Painter['measure'],
): ExportFrame {
  const exportView: ViewSettings = {
    ...view,
    showAxes: opts.showAxes,
    showGrid: opts.showGrid,
    showTickLabels: opts.showTickLabels,
    showHiddenLines: opts.showHiddenLines,
    showPointCoords: opts.showPointCoords ?? view.showPointCoords,
    axisRange: opts.fitAxes ? fittedAxisRange(scene, view.axisRange) : view.axisRange,
  };
  const drawing = projectToDrawing(scene, cam, { view: exportView, selectedId: null });
  const style: RenderStyle = { showHiddenLines: opts.showHiddenLines, lineScale: opts.lineScale, fontScale: opts.fontScale };

  const provisional: PxTransform = { scale: pxPerUnit, origin: [0, 0], cx: 0, cy: 0 };
  const box = paintedBounds(measure, drawing, provisional, style);
  const width = Math.ceil(box.maxX - box.minX + 2 * MARGIN_PX);
  const height = Math.ceil(box.maxY - box.minY + 2 * MARGIN_PX);
  return {
    width,
    height,
    transform: { scale: pxPerUnit, origin: [0, 0], cx: MARGIN_PX - box.minX, cy: MARGIN_PX - box.minY },
    drawing,
    style,
  };
}

/** Longest PNG side browsers reliably allocate; larger requests are scaled down. */
export const MAX_PNG_SIDE = 8192;

/** The PNG scale actually used for a frame: the requested one, reduced to respect MAX_PNG_SIDE. */
export function effectivePngScale(frame: Pick<ExportFrame, 'width' | 'height'>, scale: number): number {
  return Math.min(scale, MAX_PNG_SIDE / Math.max(frame.width, frame.height));
}

/** Pixel size of the PNG that renderFrameToCanvas produces (shown in the dialog, so both always agree). */
export function pngSize(
  frame: Pick<ExportFrame, 'width' | 'height'>,
  scale: number,
): { width: number; height: number; limited: boolean } {
  const k = effectivePngScale(frame, scale);
  return { width: Math.max(1, Math.round(frame.width * k)), height: Math.max(1, Math.round(frame.height * k)), limited: k < scale };
}

export function exportFileName(format: ExportFormat, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  // Seconds keep two exports made within the same minute from getting the same name.
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `空間向量繪圖_${stamp}.${format}`;
}
