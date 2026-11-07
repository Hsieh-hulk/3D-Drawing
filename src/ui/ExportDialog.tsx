import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  canShareFiles,
  downloadBlob,
  exportBlob,
  measureText,
  renderFrameToCanvas,
  shareBlob,
} from '../export/exporters';
import { buildExportFrame, exportFileName, type ExportFormat, type ExportFrame, type ExportOptions } from '../export/frame';
import { viewportRegistry } from '../render3d/viewportRegistry';
import { useAppStore } from '../store/useAppStore';
import { CloseIcon } from './icons';

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'png', label: 'PNG', hint: '圖片，最通用' },
  { value: 'pdf', label: 'PDF', hint: '向量，放大不糊' },
  { value: 'svg', label: 'SVG', hint: '向量，可再編輯' },
];
const LINE_SCALES = [
  { value: 0.8, label: '細' },
  { value: 1, label: '標準' },
  { value: 1.5, label: '粗' },
];
const FONT_SCALES = [
  { value: 0.85, label: '小' },
  { value: 1, label: '標準' },
  { value: 1.3, label: '大' },
];

function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="ex-field">
      <span className="ex-label">{props.label}</span>
      <div className="segmented" role="group" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className="btn"
            aria-pressed={props.value === o.value}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="ex-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const scene = useAppStore((s) => s.scene);
  const view = useAppStore((s) => s.view);
  const opts = useAppStore((s) => s.exportOptions);
  const setOpts = useAppStore((s) => s.setExportOptions);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const shareable = useMemo(() => canShareFiles(), []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setStatus(null);
    } else if (!open && d.open) d.close();
  }, [open]);

  const frame: ExportFrame | null = useMemo(() => {
    if (!open || !viewportRegistry.current) return null;
    const { cam, pxPerUnit } = viewportRegistry.current.getExportContext();
    return buildExportFrame(scene, cam, view, opts, pxPerUnit, measureText);
  }, [open, scene, view, opts]);

  // Live preview, rendered with the very same painter as the PNG export.
  useEffect(() => {
    const host = previewRef.current;
    if (!host || !frame) return;
    const canvas = renderFrameToCanvas(frame, Math.min(window.devicePixelRatio || 1, 2), opts.transparent ? null : '#ffffff');
    canvas.className = 'ex-preview-canvas';
    canvas.style.aspectRatio = `${frame.width} / ${frame.height}`;
    host.replaceChildren(canvas);
  }, [frame, opts.transparent]);

  const set = (patch: Partial<ExportOptions>) => {
    setOpts(patch);
    setStatus(null);
  };

  const run = async (mode: 'download' | 'share') => {
    if (!frame) return;
    setBusy(true);
    try {
      const blob = await exportBlob(frame, opts);
      const name = exportFileName(opts.format);
      if (mode === 'share') {
        const r = await shareBlob(blob, name, opts.format);
        setStatus(r === 'shared' ? { ok: true, text: '已傳送到分享選單' } : null);
      } else {
        downloadBlob(blob, name);
        setStatus({ ok: true, text: `已下載 ${name}` });
      }
    } catch (err) {
      setStatus({ ok: false, text: `匯出失敗：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const sizeText = frame
    ? opts.format === 'png'
      ? `${Math.round(frame.width * opts.pngScale)} × ${Math.round(frame.height * opts.pngScale)} px`
      : `${Math.round(frame.width * 0.75)} × ${Math.round(frame.height * 0.75)} pt（向量）`
    : '';

  return (
    <dialog ref={dialogRef} className="export-dialog" onClose={onClose} aria-labelledby="export-title">
      <div className="ex-header">
        <h2 id="export-title">匯出</h2>
        <button type="button" className="icon-btn close-btn" aria-label="關閉" title="關閉" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="ex-body">
        <div className={`ex-preview${opts.transparent ? ' is-transparent' : ''}`} ref={previewRef} aria-label="匯出預覽" role="img" />
        <p className="ex-size">{sizeText}</p>

        <div className="ex-field">
          <span className="ex-label">格式</span>
          <div className="segmented" role="group" aria-label="格式">
            {FORMATS.map((f) => (
              <button key={f.value} type="button" className="btn" aria-pressed={opts.format === f.value} onClick={() => set({ format: f.value })} title={f.hint}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <p className="ex-hint">{FORMATS.find((f) => f.value === opts.format)!.hint}</p>

        {opts.format === 'png' && (
          <Segmented<1 | 2 | 4>
            label="解析度"
            value={opts.pngScale}
            options={[
              { value: 1, label: '1×' },
              { value: 2, label: '2×' },
              { value: 4, label: '4×' },
            ]}
            onChange={(v) => set({ pngScale: v })}
          />
        )}
        <Segmented<'t' | 'w'>
          label="背景"
          value={opts.transparent ? 't' : 'w'}
          options={[
            { value: 't', label: '透明' },
            { value: 'w', label: '白色' },
          ]}
          onChange={(v) => set({ transparent: v === 't' })}
        />
        <Segmented label="線條" value={opts.lineScale} options={LINE_SCALES} onChange={(v) => set({ lineScale: v })} />
        <Segmented label="字級" value={opts.fontScale} options={FONT_SCALES} onChange={(v) => set({ fontScale: v })} />

        <div className="ex-field ex-field--wrap">
          <span className="ex-label">內容</span>
          <div className="ex-checks">
            <Check checked={opts.showAxes} onChange={(v) => set({ showAxes: v })}>
              座標軸
            </Check>
            <Check checked={opts.fitAxes} onChange={(v) => set({ fitAxes: v })}>
              座標軸配合物件長度
            </Check>
            <Check checked={opts.showTickLabels} onChange={(v) => set({ showTickLabels: v })}>
              刻度數字
            </Check>
            <Check checked={opts.showGrid} onChange={(v) => set({ showGrid: v })}>
              網格
            </Check>
            <Check checked={opts.showHiddenLines} onChange={(v) => set({ showHiddenLines: v })}>
              虛線
            </Check>
          </div>
        </div>
        <p className="ex-hint">視角與畫面相同（放大畫面＝匯出較大的圖）；圖會自動裁切到內容範圍。</p>
        <p className="ex-hint">貼進 GoodNotes 建議：PDF 放大最清楚；PNG 透明背景可疊在筆記紙上。</p>
      </div>

      <div className="ex-actions">
        {shareable && (
          <button type="button" className="btn btn-primary" disabled={busy || !frame} onClick={() => run('share')}>
            分享到其他 App
          </button>
        )}
        <button type="button" className={`btn ${shareable ? 'btn-outline' : 'btn-primary'}`} disabled={busy || !frame} onClick={() => run('download')}>
          下載
        </button>
      </div>
      <p className="ex-hint ex-share-hint">
        {shareable
          ? 'iPad：按「分享到其他 App」後選擇 GoodNotes，即可直接放進筆記。'
          : '這個瀏覽器不支援直接分享檔案，請下載後再匯入 GoodNotes。（iPad Safari 以 HTTPS 或本機網址開啟時會出現「分享」按鈕）'}
      </p>
      <p className={`feedback ${status ? (status.ok ? 'is-ok' : 'is-error') : ''}`} aria-live="polite">
        {status?.text ?? ''}
      </p>
    </dialog>
  );
}
