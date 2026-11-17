import { useRef, useState } from 'react';
import type { ViewPreset, ViewSettings } from '../model/types';
import { VIEW_PRESET_LABELS } from '../model/viewPresets';
import { ROTATE_SPEED_MAX, ROTATE_SPEED_MIN, ROTATE_SPEED_STEP } from '../store/persistence';
import { useAppStore } from '../store/useAppStore';
import { ExportDialog } from './ExportDialog';
import { RedoIcon, UndoIcon } from './icons';

const PRESETS: ViewPreset[] = ['textbook', 'front', 'right', 'top'];
const SNAPS: { value: ViewSettings['snap']; label: string }[] = [
  { value: 1, label: '1' },
  { value: 0.5, label: '0.5' },
  { value: 0, label: '關' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

export function Toolbar() {
  const view = useAppStore((s) => s.view);
  const setPreset = useAppStore((s) => s.setPreset);
  const toggleGrid = useAppStore((s) => s.toggleGrid);
  const toggleTickLabels = useAppStore((s) => s.toggleTickLabels);
  const togglePointCoords = useAppStore((s) => s.togglePointCoords);
  const toggleHiddenLines = useAppStore((s) => s.toggleHiddenLines);
  const setSnap = useAppStore((s) => s.setSnap);
  const placeMode = useAppStore((s) => s.placeMode);
  const rotateSpeed = useAppStore((s) => s.rotateSpeed);
  const setRotateSpeed = useAppStore((s) => s.setRotateSpeed);
  const canUndo = useAppStore((s) => s.past.length > 0);
  const canRedo = useAppStore((s) => s.future.length > 0);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const [exportOpen, setExportOpen] = useState(false);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const closeExport = () => {
    setExportOpen(false);
    // Return focus to the button that opened the dialog (keyboard / screen-reader users).
    requestAnimationFrame(() => exportBtnRef.current?.focus());
  };

  return (
    <header className="toolbar">
      <h1 className="toolbar-title">空間向量繪圖</h1>
      <div className="toolbar-groups" role="toolbar" aria-label="繪圖工具">
        <div className="segmented" role="group" aria-label="復原與重做">
          <button type="button" className="btn btn-icon" onClick={undo} disabled={!canUndo} aria-label="復原" title={`復原（${MOD}Z）`}>
            <UndoIcon />
          </button>
          <button type="button" className="btn btn-icon" onClick={redo} disabled={!canRedo} aria-label="重做" title={`重做（${MOD}Shift+Z）`}>
            <RedoIcon />
          </button>
        </div>
        <div className="segmented" role="group" aria-label="視角">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="btn" aria-pressed={view.preset === p} onClick={() => setPreset(p)}>
              {VIEW_PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="顯示">
          <button type="button" className="btn" aria-pressed={view.showGrid} onClick={toggleGrid}>
            網格
          </button>
          <button type="button" className="btn" aria-pressed={view.showTickLabels} onClick={toggleTickLabels}>
            刻度數字
          </button>
          <button type="button" className="btn" aria-pressed={view.showPointCoords} onClick={togglePointCoords}>
            座標標籤
          </button>
          <button type="button" className="btn" aria-pressed={view.showHiddenLines} onClick={toggleHiddenLines} title="被遮住的邊以虛線顯示">
            虛線
          </button>
        </div>
        <div className="segmented segmented--labelled rotate-speed" role="group" aria-label="旋轉靈敏度">
          <label className="segmented-label" htmlFor="rotate-speed">
            旋轉靈敏度
          </label>
          <button
            type="button"
            className="btn rotate-speed-step"
            aria-label="降低旋轉靈敏度"
            disabled={rotateSpeed <= ROTATE_SPEED_MIN}
            onClick={() => setRotateSpeed(rotateSpeed - ROTATE_SPEED_STEP)}
          >
            −
          </button>
          <input
            id="rotate-speed"
            className="rotate-speed-input"
            type="range"
            min={ROTATE_SPEED_MIN}
            max={ROTATE_SPEED_MAX}
            step={ROTATE_SPEED_STEP}
            value={rotateSpeed}
            onChange={(e) => setRotateSpeed(Number(e.target.value))}
          />
          <button
            type="button"
            className="btn rotate-speed-step"
            aria-label="提高旋轉靈敏度"
            disabled={rotateSpeed >= ROTATE_SPEED_MAX}
            onClick={() => setRotateSpeed(rotateSpeed + ROTATE_SPEED_STEP)}
          >
            +
          </button>
          <output className="rotate-speed-value" htmlFor="rotate-speed">
            {rotateSpeed.toFixed(1)}
          </output>
        </div>
        {placeMode && (
          <div className="segmented segmented--labelled" role="group" aria-label="拖曳吸附">
            <span className="segmented-label" aria-hidden="true">
              吸附
            </span>
            {SNAPS.map((s) => (
              <button
                key={s.value}
                type="button"
                className="btn"
                aria-pressed={view.snap === s.value}
                aria-label={s.value === 0 ? '不吸附' : `吸附到 ${s.label}`}
                onClick={() => setSnap(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button ref={exportBtnRef} type="button" className="btn btn-primary toolbar-export" onClick={() => setExportOpen(true)}>
        匯出
      </button>
      <ExportDialog open={exportOpen} onClose={closeExport} />
    </header>
  );
}
