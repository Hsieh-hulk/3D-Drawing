import type { Pt2 } from '../projection/types';
import { paintDrawing, type FontSpec, type Painter, type StrokeSpec } from '../render2d/paint';
import type { ExportFrame } from './frame';

/**
 * Minimal dependency-free vector PDF writer (PDF 1.4, one page, uncompressed ASCII content).
 * Text uses the standard 14 fonts so it stays selectable and needs no embedding; √ and π are drawn
 * with the standard Symbol font because they are missing from WinAnsiEncoding.
 */

const PX_TO_PT = 0.75;

const FONT_RESOURCES = {
  F1: 'Times-BoldItalic',
  F2: 'Times-Italic',
  F3: 'Helvetica',
  F4: 'Symbol',
  F5: 'Times-Roman',
} as const;
type FontKey = keyof typeof FONT_RESOURCES;

/** Characters routed to the Symbol font, with their Symbol-encoding byte. */
const SYMBOL_CODES: Record<string, number> = { '√': 0xd6, 'π': 0x70, '·': 0xd7 };

const f = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export function parseColor(c: string): [number, number, number] {
  const hex = c.trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex;
  if (/^[0-9a-f]{6}$/i.test(full)) {
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  return [0, 0, 0];
}

/** WinAnsi byte for a character, '?' when it cannot be represented. */
function winAnsi(ch: string): number {
  const code = ch.codePointAt(0)!;
  if (code >= 0x20 && code < 0x7f) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return 0x3f;
}

const hexBytes = (bytes: number[]) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;

function mainFontKey(font: FontSpec): FontKey {
  if (font.generic === 'sans') return 'F3';
  if (!font.italic) return 'F5';
  return font.weight >= 600 ? 'F1' : 'F2';
}

export class PdfPainter implements Painter {
  private readonly ops: string[] = [];
  /** Alpha value → ExtGState resource name. */
  readonly alphas = new Map<number, string>();

  constructor(private readonly measureFn: Painter['measure']) {}

  get content(): string {
    return this.ops.join('\n');
  }

  private gs(alpha: number): string {
    if (alpha >= 1) return '';
    const a = Math.round(alpha * 100) / 100;
    let name = this.alphas.get(a);
    if (!name) {
      name = `GS${this.alphas.size}`;
      this.alphas.set(a, name);
    }
    return `/${name} gs `;
  }

  line(a: Pt2, b: Pt2, s: StrokeSpec): void {
    const [r, g, bl] = parseColor(s.color);
    const dash = `[${s.dash.map(f).join(' ')}] 0 d`;
    this.ops.push(`q ${this.gs(s.alpha)}${f(r)} ${f(g)} ${f(bl)} RG ${f(s.width)} w 1 J 1 j ${dash} ${f(a[0])} ${f(a[1])} m ${f(b[0])} ${f(b[1])} l S Q`);
  }

  polygon(pts: Pt2[], color: string, alpha: number): void {
    if (pts.length < 3) return;
    const [r, g, b] = parseColor(color);
    const path = pts.map((p, i) => `${f(p[0])} ${f(p[1])} ${i === 0 ? 'm' : 'l'}`).join(' ');
    this.ops.push(`q ${this.gs(alpha)}${f(r)} ${f(g)} ${f(b)} rg ${path} h f Q`);
  }

  circle(c: Pt2, rad: number, fill: string | null, stroke: { color: string; width: number } | null, alpha: number): void {
    const k = 0.5523 * rad;
    const [x, y] = c;
    const path = [
      `${f(x + rad)} ${f(y)} m`,
      `${f(x + rad)} ${f(y + k)} ${f(x + k)} ${f(y + rad)} ${f(x)} ${f(y + rad)} c`,
      `${f(x - k)} ${f(y + rad)} ${f(x - rad)} ${f(y + k)} ${f(x - rad)} ${f(y)} c`,
      `${f(x - rad)} ${f(y - k)} ${f(x - k)} ${f(y - rad)} ${f(x)} ${f(y - rad)} c`,
      `${f(x + k)} ${f(y - rad)} ${f(x + rad)} ${f(y - k)} ${f(x + rad)} ${f(y)} c h`,
    ].join(' ');
    let paint = '';
    let colors = '';
    if (fill) {
      const [r, g, b] = parseColor(fill);
      colors += `${f(r)} ${f(g)} ${f(b)} rg `;
    }
    if (stroke) {
      const [r, g, b] = parseColor(stroke.color);
      colors += `${f(r)} ${f(g)} ${f(b)} RG ${f(stroke.width)} w `;
    }
    if (fill && stroke) paint = 'B';
    else if (fill) paint = 'f';
    else if (stroke) paint = 'S';
    else return;
    this.ops.push(`q ${this.gs(alpha)}${colors}${path} ${paint} Q`);
  }

  text(str: string, x: number, yMid: number, font: FontSpec, color: string, halo: boolean): void {
    // Split into runs: Symbol-font characters vs. the main font.
    const runs: { key: FontKey; text: string }[] = [];
    for (const ch of str) {
      const key: FontKey = Object.hasOwn(SYMBOL_CODES, ch) ? 'F4' : mainFontKey(font);
      const last = runs[runs.length - 1];
      if (last && last.key === key) last.text += ch;
      else runs.push({ key, text: ch });
    }
    const baseline = yMid + font.size * 0.34;
    const [r, g, b] = parseColor(color);
    let cx = x;
    for (const run of runs) {
      const bytes = [...run.text].map((ch) => (run.key === 'F4' ? SYMBOL_CODES[ch] : winAnsi(ch === '−' ? '-' : ch)));
      // The page CTM flips y, so each text object flips it back with its text matrix.
      const tm = `1 0 0 -1 ${f(cx)} ${f(baseline)} Tm`;
      const tf = `/${run.key} ${f(font.size)} Tf`;
      if (halo) this.ops.push(`q 1 1 1 RG 4 w 1 j BT ${tf} ${tm} 1 Tr ${hexBytes(bytes)} Tj ET Q`);
      this.ops.push(`q ${f(r)} ${f(g)} ${f(b)} rg BT ${tf} ${tm} 0 Tr ${hexBytes(bytes)} Tj ET Q`);
      cx += this.measureFn(run.text, font);
    }
  }

  measure(str: string, font: FontSpec): number {
    return this.measureFn(str, font);
  }
}

/** Serializes a single-page PDF; page size = frame size (px → pt). */
export function frameToPdf(frame: ExportFrame, measure: Painter['measure'], background: string | null): string {
  const p = new PdfPainter(measure);
  if (background) p.polygon([[0, 0], [frame.width, 0], [frame.width, frame.height], [0, frame.height]], background, 1);
  paintDrawing(p, frame.drawing, frame.transform, frame.style);

  const wPt = frame.width * PX_TO_PT;
  const hPt = frame.height * PX_TO_PT;
  // Draw in px with y down: scale px → pt and flip the page vertically.
  const content = `${f(PX_TO_PT)} 0 0 ${f(-PX_TO_PT)} 0 ${f(hPt)} cm\n${p.content}`;

  const fontEntries = Object.keys(FONT_RESOURCES) as FontKey[];
  const firstFontObj = 5;
  const firstGsObj = firstFontObj + fontEntries.length;
  const gsList = [...p.alphas.entries()];

  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const fontDict = fontEntries.map((k, i) => `/${k} ${firstFontObj + i} 0 R`).join(' ');
  const gsDict = gsList.map(([, name], i) => `/${name} ${firstGsObj + i} 0 R`).join(' ');
  objects[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(wPt)} ${f(hPt)}] ` +
    `/Resources << /Font << ${fontDict} >> /ExtGState << ${gsDict} >> >> /Contents 4 0 R >>`;
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  fontEntries.forEach((k, i) => {
    const base = FONT_RESOURCES[k];
    const enc = base === 'Symbol' ? '' : ' /Encoding /WinAnsiEncoding';
    objects[firstFontObj + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${base}${enc} >>`;
  });
  gsList.forEach(([alpha], i) => {
    objects[firstGsObj + i] = `<< /Type /ExtGState /CA ${f(alpha)} /ca ${f(alpha)} >>`;
  });

  // Everything is ASCII, so string length equals byte length for the xref offsets.
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return out;
}
