import { describe, expect, it } from 'vitest';
import { EMPTY_SCENE } from '../src/model/scene';
import type { ViewPreset, ViewSettings } from '../src/model/types';
import { normalize, scale } from '../src/model/vec3';
import { presetCameraPosition, screenBasis } from '../src/model/viewPresets';
import {
  MAX_TICKS_PER_AXIS,
  MIN_TICK_GAP_PX,
  axisStep,
  clean,
  formatTick,
  lineRangeInRect,
  niceStep,
  thinFactor,
  xyPlaneRange,
} from '../src/projection/axisScale';
import { projectAutoAxes, projectToDrawing, sceneOccluders, type AxisWindow } from '../src/projection/project';
import type { LabelPrim, Pt2, TickPrim, ViewCamera } from '../src/projection/types';

function camera(preset: ViewPreset): ViewCamera {
  const pos = presetCameraPosition(preset, 30);
  const { right, up } = screenBasis(pos);
  return { right, up, forward: normalize(scale(pos, -1)) };
}

const VIEW: ViewSettings = {
  preset: 'textbook',
  showGrid: true,
  showAxes: true,
  showTickLabels: true,
  showPointCoords: false,
  showHiddenLines: true,
  snap: 1,
  axisRange: 5,
};

/** Window of a 1000×700 px viewport centred on the origin. */
function windowAt(pxPerUnit: number, w = 1000, h = 700): AxisWindow {
  const hw = w / 2 / pxPerUnit;
  const hh = h / 2 / pxPerUnit;
  return { rect: { minX: -hw, maxX: hw, minY: -hh, maxY: hh }, pxPerUnit };
}

describe('niceStep', () => {
  it('follows the 1-2-5 sequence', () => {
    expect(niceStep(60)).toBe(1); // 40/60 → 1
    expect(niceStep(30)).toBe(2); // 40/30 = 1.33 → 2
    expect(niceStep(12)).toBe(5); // 40/12 = 3.33 → 5
    expect(niceStep(6)).toBe(10); // 40/6 = 6.7 → 10
    expect(niceStep(100)).toBe(0.5);
    expect(niceStep(150)).toBe(0.5);
    expect(niceStep(250)).toBe(0.2);
  });

  it('zoomed in to the 0.001 level and out to the 1000 level, without float noise', () => {
    expect(niceStep(40_000)).toBe(0.001);
    expect(niceStep(15_000)).toBe(0.005);
    expect(niceStep(0.05)).toBe(1000);
    expect(niceStep(0.015)).toBe(5000);
  });

  it('keeps the step of 1 at the default zoom of the textbook view', () => {
    expect(axisStep(camera('textbook'), 48)).toBe(1);
  });

  it('keeps the on-screen gap between MIN_TICK_GAP_PX and 2.5× that, for every zoom', () => {
    for (let ppu = 0.01; ppu < 1e6; ppu *= 1.07) {
      const gap = niceStep(ppu) * ppu;
      expect(gap).toBeGreaterThanOrEqual(MIN_TICK_GAP_PX * (1 - 1e-9));
      expect(gap).toBeLessThanOrEqual(MIN_TICK_GAP_PX * 2.5 * (1 + 1e-9));
    }
  });
});

describe('formatTick', () => {
  it('removes floating-point noise', () => {
    expect(clean(0.1 + 0.2)).toBe(0.3);
    expect(formatTick(0.1 + 0.2, 0.1)).toBe('0.3');
    expect(formatTick(3 * 0.1, 0.1)).toBe('0.3');
    expect(formatTick(7 * 0.001, 0.001)).toBe('0.007');
  });

  it('uses as many decimals as the step needs', () => {
    expect(formatTick(2, 1)).toBe('2');
    expect(formatTick(-4, 2)).toBe('-4');
    expect(formatTick(1, 0.5)).toBe('1');
    expect(formatTick(1.5, 0.5)).toBe('1.5');
    expect(formatTick(0.01, 0.005)).toBe('0.01');
    expect(formatTick(0.25, 0.05)).toBe('0.25');
    expect(formatTick(3000, 1000)).toBe('3000');
    expect(formatTick(-0.000000001, 0.1)).toBe('-1e-9');
    expect(formatTick(0, 0.1)).toBe('0');
  });

  it('switches to exponent form for extreme values', () => {
    expect(formatTick(2_000_000, 1_000_000)).toBe('2e6');
    expect(formatTick(0.00005, 0.00001)).toBe('5e-5');
  });
});

describe('geometry helpers', () => {
  it('lineRangeInRect clips a line through the origin', () => {
    expect(lineRangeInRect([1, 0], { minX: -2, maxX: 3, minY: -1, maxY: 1 })).toEqual([-2, 3]);
    expect(lineRangeInRect([1, 1], { minX: -2, maxX: 3, minY: -1, maxY: 1 })).toEqual([-1, 1]);
    expect(lineRangeInRect([1, 0], { minX: -2, maxX: 3, minY: 1, maxY: 2 })).toBeNull(); // panned away
  });

  it('thinFactor picks 1, 2, 5, 10, …', () => {
    expect(thinFactor(10, 8)).toBe(1);
    expect(thinFactor(5, 8)).toBe(2);
    expect(thinFactor(2, 8)).toBe(5);
    expect(thinFactor(1, 8)).toBe(10);
  });

  it('xyPlaneRange covers the screen in the top view and is null when edge-on', () => {
    const r = xyPlaneRange(camera('top'), { minX: -4, maxX: 4, minY: -3, maxY: 3 });
    expect(r).not.toBeNull();
    expect(r!.x[1] - r!.x[0]).toBeGreaterThan(5.9);
    expect(r!.y[1] - r!.y[0]).toBeGreaterThan(7.9);
    expect(xyPlaneRange(camera('front'), { minX: -4, maxX: 4, minY: -3, maxY: 3 })).toBeNull();
  });
});

describe('projectAutoAxes', () => {
  const cam = camera('textbook');
  const occ = sceneOccluders(EMPTY_SCENE, cam);
  const ticksOf = (ppu: number) => projectAutoAxes(cam, VIEW, occ, windowAt(ppu)).filter((p): p is TickPrim => p.type === 'tick');
  const labelsOf = (ppu: number) =>
    projectAutoAxes(cam, VIEW, occ, windowAt(ppu)).filter((p): p is LabelPrim => p.type === 'label' && p.style === 'tick');

  it('uses a finer step when zoomed in, and keeps the main axes’ tick gap in range', () => {
    const base = 48; // zoom 1 in a 600 px tall viewport with axisRange 5
    const s1 = axisStep(cam, base);
    const s10 = axisStep(cam, base * 10);
    expect(s10).toBeLessThan(s1);
    for (const ppu of [base, base * 10]) {
      // The z-axis is vertical and not foreshortened in the textbook view.
      const zTicks = ticksOf(ppu)
        .filter((t) => Math.abs(t.p[0]) < 1e-9)
        .map((t) => t.p[1])
        .concat([0]) // the origin carries "O" instead of a tick
        .sort((a, b) => a - b);
      const gaps = zTicks.slice(1).map((y, i) => (y - zTicks[i]) * ppu);
      expect(gaps.length).toBeGreaterThan(3);
      for (const g of gaps) {
        expect(g).toBeGreaterThanOrEqual(MIN_TICK_GAP_PX - 1e-6);
        expect(g).toBeLessThanOrEqual(MIN_TICK_GAP_PX * 2.5 + 1e-6);
      }
    }
  });

  it('labels show the zoom-dependent values', () => {
    const texts = labelsOf(48 * 40).map((l) => l.text);
    expect(texts.some((t) => t.includes('.'))).toBe(true); // decimal ticks when zoomed in
    expect(texts.every((t) => !/\d{6,}/.test(t))).toBe(true); // no 0.30000000000000004
    const far = labelsOf(0.5).map((l) => Number(l.text));
    expect(Math.max(...far)).toBeGreaterThanOrEqual(500);
  });

  it('axes reach the edge of the window, whatever the zoom', () => {
    for (const ppu of [1, 48, 4800]) {
      const win = windowAt(ppu);
      const axisLines = projectAutoAxes(cam, VIEW, occ, win).filter((p) => p.type === 'line' && p.role === 'axis');
      const pts = axisLines.flatMap((l) => (l.type === 'line' ? [l.a, l.b] : [])) as Pt2[];
      const maxY = Math.max(...pts.map((p) => p[1]));
      const minY = Math.min(...pts.map((p) => p[1]));
      // z runs from (just past) the bottom edge to the arrow tip near the top edge.
      expect(minY).toBeLessThanOrEqual(win.rect.minY);
      expect(maxY).toBeGreaterThan(win.rect.maxY - 40 / ppu);
    }
  });

  it('caps the number of ticks per axis and never overlaps labels on the vertical axis', () => {
    for (const ppu of [0.02, 1, 48, 1e4, 1e6]) {
      const ticks = ticksOf(ppu);
      expect(ticks.length).toBeLessThanOrEqual(3 * MAX_TICKS_PER_AXIS);
      const z = labelsOf(ppu)
        .filter((l) => Math.abs(l.p[0]) < 1e-9)
        .map((l) => l.p[1] * ppu)
        .sort((a, b) => a - b);
      for (let i = 1; i < z.length; i++) expect(z[i] - z[i - 1]).toBeGreaterThanOrEqual(14);
    }
  });

  it('a panned-away axis is simply not drawn', () => {
    const win: AxisWindow = { rect: { minX: 100, maxX: 110, minY: 100, maxY: 107 }, pxPerUnit: 100 };
    const prims = projectAutoAxes(camera('front'), { ...VIEW, showGrid: false }, sceneOccluders(EMPTY_SCENE, camera('front')), win);
    expect(prims.filter((p) => p.type === 'line')).toHaveLength(0);
  });
});

describe('projectToDrawing compatibility', () => {
  it('without the new options the output is unchanged (fixed ±axisRange axes)', () => {
    const cam = camera('textbook');
    const d = projectToDrawing(EMPTY_SCENE, cam, { view: VIEW, selectedId: null });
    const ticks = d.prims.filter((p) => p.type === 'tick');
    expect(ticks).toHaveLength(3 * 10); // -5..5 without 0 on each axis
    const labels = d.prims.filter((p): p is LabelPrim => p.type === 'label' && p.style === 'tick').map((l) => l.text);
    expect(new Set(labels)).toEqual(new Set(['-5', '-4', '-3', '-2', '-1', '1', '2', '3', '4', '5']));
  });

  it("axes: 'none' leaves out axes and grid but nothing else", () => {
    const d = projectToDrawing(EMPTY_SCENE, camera('textbook'), { view: VIEW, selectedId: null, axes: 'none' });
    expect(d.prims.filter((p) => p.type === 'tick' || (p.type === 'line' && (p.role === 'axis' || p.role === 'grid')))).toHaveLength(0);
  });
});
