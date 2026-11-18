import { useEffect, useRef, useState } from 'react';
import { viewportRegistry } from '../render3d/viewportRegistry';
import { VIEW_PRESET_LABELS } from '../model/viewPresets';
import { ROTATE_SPEED_MAX, ROTATE_SPEED_MIN, ROTATE_SPEED_STEP } from '../store/persistence';
import { useAppStore } from '../store/useAppStore';
import { CubeIcon, MinusIcon, PlusIcon, TopViewIcon, WrenchIcon } from './icons';

const ZOOM_STEP = 1.25;

/** Floating tool cluster at the top-right of the drawing: view presets, settings and zoom. */
export function ViewTools() {
  const view = useAppStore((s) => s.view);
  const setPreset = useAppStore((s) => s.setPreset);
  const toggleGrid = useAppStore((s) => s.toggleGrid);
  const toggleTickLabels = useAppStore((s) => s.toggleTickLabels);
  const togglePointCoords = useAppStore((s) => s.togglePointCoords);
  const toggleHiddenLines = useAppStore((s) => s.toggleHiddenLines);
  const rotateSpeed = useAppStore((s) => s.rotateSpeed);
  const setRotateSpeed = useAppStore((s) => s.setRotateSpeed);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const zoom = (f: number) => viewportRegistry.current?.zoomBy(f);

  return (
    <div className="view-tools" ref={rootRef}>
      <div className="view-tools-row">
        <div className="view-tools-group" role="group" aria-label="視角">
          <button
            type="button"
            className="vt-btn"
            aria-pressed={view.preset === 'textbook'}
            aria-label={VIEW_PRESET_LABELS.textbook}
            title={VIEW_PRESET_LABELS.textbook}
            onClick={() => setPreset('textbook')}
          >
            <CubeIcon />
          </button>
          <button
            type="button"
            className="vt-btn"
            aria-pressed={view.preset === 'top'}
            aria-label="上視圖（X、Y）"
            title="上視圖（X、Y）"
            onClick={() => setPreset('top')}
          >
            <TopViewIcon />
          </button>
        </div>
        <button
          type="button"
          className="vt-btn vt-btn--solo"
          aria-expanded={open}
          aria-label="設定"
          title="設定"
          onClick={() => setOpen((o) => !o)}
        >
          <WrenchIcon />
        </button>
      </div>

      {open && (
        <div className="settings-popover" role="dialog" aria-label="設定">
          <h2 className="settings-title">顯示</h2>
          <div className="segmented segmented--wrap" role="group" aria-label="顯示">
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
          <h2 className="settings-title">
            <label htmlFor="rotate-speed">旋轉靈敏度</label>
          </h2>
          <div className="rotate-speed" role="group" aria-label="旋轉靈敏度">
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
        </div>
      )}

      <div className="view-tools-group view-tools-zoom" role="group" aria-label="縮放">
        <button type="button" className="vt-btn" aria-label="放大" title="放大" onClick={() => zoom(ZOOM_STEP)}>
          <PlusIcon />
        </button>
        <button type="button" className="vt-btn" aria-label="縮小" title="縮小" onClick={() => zoom(1 / ZOOM_STEP)}>
          <MinusIcon />
        </button>
      </div>
    </div>
  );
}
