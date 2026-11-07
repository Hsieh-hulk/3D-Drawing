import { describe, expect, it } from 'vitest';
import {
  buildExportFrame,
  DEFAULT_EXPORT_OPTIONS,
  exportFileName,
  fittedAxisRange,
  type ExportOptions,
} from '../src/export/frame';
import { frameToPdf, parseColor } from '../src/export/pdf';
import { frameToSvg } from '../src/export/svg';
import { runCommand } from '../src/model/commands';
import { EMPTY_SCENE, solids, type Scene } from '../src/model/scene';
import { createSolid } from '../src/model/solids';
import type { ViewSettings } from '../src/model/types';
import { normalize, scale } from '../src/model/vec3';
import { presetCameraPosition, screenBasis } from '../src/model/viewPresets';
import type { LinePrim } from '../src/projection/types';
import { paintedBounds, type FontSpec } from '../src/render2d/paint';

/** Deterministic stand-in for canvas text measurement (node has no canvas). */
const measure = (s: string, f: FontSpec) => [...s].length * f.size * 0.55;

const pos = presetCameraPosition('textbook', 30);
const { right, up } = screenBasis(pos);
const cam = { right, up, forward: normalize(scale(pos, -1)) };
const view: ViewSettings = {
  preset: 'textbook',
  showGrid: true,
  showAxes: true,
  showTickLabels: true,
  showPointCoords: true,
  showHiddenLines: true,
  snap: 1,
  axisRange: 5,
};

function sampleScene(): Scene {
  const r = createSolid(EMPTY_SCENE, 'cube', { a: 2 });
  if (!r.ok) throw new Error(r.error);
  let s = r.scene;
  for (const cmd of ['P(1, sqrt(3), pi/2)', 'AG', 'u = (0, 1, 2)']) {
    const x = runCommand(cmd, s);
    if (!x.ok) throw new Error(x.error);
    s = x.scene;
  }
  return s;
}

const opts = (patch: Partial<ExportOptions> = {}): ExportOptions => ({ ...DEFAULT_EXPORT_OPTIONS, ...patch });

describe('export frame', () => {
  it('crops the page to the painted content plus a 16px margin', () => {
    const frame = buildExportFrame(sampleScene(), cam, view, opts(), 60, measure);
    const box = paintedBounds(measure, frame.drawing, frame.transform, frame.style);
    expect(box.minX).toBeCloseTo(16, 5);
    expect(box.minY).toBeCloseTo(16, 5);
    expect(frame.width - box.maxX).toBeGreaterThanOrEqual(16);
    expect(frame.width - box.maxX).toBeLessThan(17);
    expect(frame.height - box.maxY).toBeLessThan(17);
  });

  it('applies the export toggles and never exports the selection', () => {
    const scene = sampleScene();
    const selected = { ...view };
    const frame = buildExportFrame(scene, cam, selected, opts({ showAxes: false, showGrid: false }), 60, measure);
    const lines = frame.drawing.prims.filter((p): p is LinePrim => p.type === 'line');
    expect(lines.some((l) => l.role === 'axis' || l.role === 'grid')).toBe(false);
    expect(frame.drawing.prims.some((p) => 'selected' in p && p.selected)).toBe(false);
  });

  it('a bigger on-screen zoom gives a bigger export', () => {
    const s = sampleScene();
    const small = buildExportFrame(s, cam, view, opts(), 40, measure);
    const big = buildExportFrame(s, cam, view, opts(), 80, measure);
    expect(big.width).toBeGreaterThan(small.width * 1.5);
  });

  it('fits the axes to the objects so small figures fill the export', () => {
    const s = sampleScene(); // cube of side 2 → axes to ±3
    expect(fittedAxisRange(s, 5)).toBe(3);
    expect(fittedAxisRange(EMPTY_SCENE, 5)).toBe(2);
    const fitted = buildExportFrame(s, cam, view, opts({ fitAxes: true }), 60, measure);
    const full = buildExportFrame(s, cam, view, opts({ fitAxes: false }), 60, measure);
    expect(fitted.width).toBeLessThan(full.width * 0.8);
  });

  it('names files with a timestamp and the right extension', () => {
    expect(exportFileName('pdf', new Date(2026, 10, 7, 9, 5))).toBe('空間向量繪圖_20261107-0905.pdf');
  });
});

describe('SVG export', () => {
  it('draws one dashed line per hidden run and escapes text', () => {
    const frame = buildExportFrame(sampleScene(), cam, view, opts({ showGrid: false }), 60, measure);
    const svg = frameToSvg(frame, measure, null);
    const hidden = frame.drawing.prims.filter((p): p is LinePrim => p.type === 'line' && p.hidden && p.role !== 'guide');
    expect(hidden.length).toBeGreaterThanOrEqual(3);
    expect(svg.match(/stroke-dasharray="6 4"/g)?.length).toBe(hidden.length);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/<text[^>]*>[^<]*<[^/]/); // no raw "<" inside text content
    expect(svg).toContain('(1, √3, π/2)');
  });

  it('adds a white background only when not transparent', () => {
    const frame = buildExportFrame(sampleScene(), cam, view, opts(), 60, measure);
    expect(frameToSvg(frame, measure, null)).not.toContain('<rect');
    expect(frameToSvg(frame, measure, '#ffffff')).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
  });
});

describe('PDF export', () => {
  const frame = buildExportFrame(sampleScene(), cam, view, opts({ showGrid: false }), 60, measure);
  const pdf = frameToPdf(frame, measure, null);

  it('is a structurally valid PDF with a correct xref table', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const count = Number(/xref\n0 (\d+)\n/.exec(pdf)![1]);
    const entries = pdf.slice(startxref).split('\n').slice(3, 2 + count);
    entries.forEach((line, i) => {
      const offset = Number(line.slice(0, 10));
      expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('declares the content stream length exactly', () => {
    const m = /4 0 obj\n<< \/Length (\d+) >>\nstream\n/.exec(pdf)!;
    const start = m.index + m[0].length;
    const end = pdf.indexOf('\nendstream', start);
    expect(end - start).toBe(Number(m[1]));
  });

  it('is pure ASCII so offsets equal byte positions', () => {
    expect(/^[\x00-\x7f]*$/.test(pdf)).toBe(true);
  });

  it('keeps text as selectable standard-font text, with √ and π in the Symbol font', () => {
    expect(pdf).toContain('/BaseFont /Times-BoldItalic');
    expect(pdf).toContain('/BaseFont /Symbol');
    expect(pdf).toMatch(/\/F1 [\d.]+ Tf .* <41> Tj/); // "A" as a point label
    expect(pdf).toMatch(/\/F4 [\d.]+ Tf .* <d6> Tj/); // √
    expect(pdf).toMatch(/\/F4 [\d.]+ Tf .* <70> Tj/); // π
  });

  it('draws hidden edges dashed and uses ExtGState for transparency', () => {
    const hidden = frame.drawing.prims.filter((p): p is LinePrim => p.type === 'line' && p.hidden && p.role !== 'guide');
    expect(pdf.match(/\[6 4\] 0 d/g)?.length).toBe(hidden.length);
    expect(pdf).toContain('/Type /ExtGState');
  });

  it('page size is the cropped frame in points', () => {
    expect(pdf).toContain(`/MediaBox [0 0 ${frame.width * 0.75} ${frame.height * 0.75}]`);
  });

  it('parses colours', () => {
    expect(parseColor('#ff0000')).toEqual([1, 0, 0]);
    expect(parseColor('#fff')).toEqual([1, 1, 1]);
  });

  it('exports an empty scene (axes only) without errors', () => {
    const f = buildExportFrame(EMPTY_SCENE, cam, view, opts(), 60, measure);
    expect(frameToPdf(f, measure, '#ffffff')).toContain('%%EOF');
    expect(solids(EMPTY_SCENE)).toHaveLength(0);
  });
});
