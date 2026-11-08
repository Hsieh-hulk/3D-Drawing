import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { SceneController } from './SceneController';
import { viewportRegistry } from './viewportRegistry';

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const view = useAppStore((s) => s.view);
  const viewRequestId = useAppStore((s) => s.viewRequestId);
  const scene = useAppStore((s) => s.scene);
  const selectedId = useAppStore((s) => s.selectedId);
  const placeMode = useAppStore((s) => s.placeMode);
  const togglePlaceMode = useAppStore((s) => s.togglePlaceMode);
  const drawTool = useAppStore((s) => s.drawTool);
  const faceDraft = useAppStore((s) => s.faceDraft);
  const toolMessage = useAppStore((s) => s.toolMessage);
  const setDrawTool = useAppStore((s) => s.setDrawTool);
  const finishFace = useAppStore((s) => s.finishFace);
  const cancelFace = useAppStore((s) => s.cancelFace);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const store = useAppStore.getState;
    const controller = new SceneController(container, {
      onSelect: (id) => store().select(id),
      onDragStart: () => store().beginDrag(),
      onDragMove: (id, pos) => store().movePointLive(id, pos),
      onPlace: (pos) => store().addPointAt(pos),
      onConnect: (a, b) => store().connectPoints(a, b),
      onFaceVertex: (id) => store().toggleFaceVertex(id),
    });
    controllerRef.current = controller;
    viewportRegistry.current = controller;
    const state = store();
    controller.applySettings(state.view);
    controller.syncScene(state.scene, state.selectedId);
    controller.setPlaceMode(state.placeMode);
    controller.setDrawTool(state.drawTool, state.faceDraft);
    controller.goToPreset(state.view.preset, false);
    return () => {
      controller.dispose();
      controllerRef.current = null;
      if (viewportRegistry.current === controller) viewportRegistry.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.applySettings(view);
  }, [view]);

  useEffect(() => {
    controllerRef.current?.syncScene(scene, selectedId);
  }, [scene, selectedId]);

  useEffect(() => {
    controllerRef.current?.setPlaceMode(placeMode);
  }, [placeMode]);

  useEffect(() => {
    controllerRef.current?.setDrawTool(drawTool, faceDraft);
  }, [drawTool, faceDraft]);

  // Keyboard: Enter finishes the face, Backspace removes the last vertex, Escape cancels / leaves the tool.
  useEffect(() => {
    if (!drawTool) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const st = useAppStore.getState();
      if (e.key === 'Escape') {
        if (st.faceDraft.length > 0) st.cancelFace();
        else st.setDrawTool(null);
      } else if (drawTool === 'face' && e.key === 'Enter' && st.faceDraft.length >= 3) {
        e.preventDefault();
        st.finishFace();
      } else if (drawTool === 'face' && e.key === 'Backspace' && st.faceDraft.length > 0) {
        e.preventDefault();
        st.toggleFaceVertex(st.faceDraft[st.faceDraft.length - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawTool]);

  const hint =
    drawTool === 'line'
      ? '從一個點拖到另一個點就會連成線段・拖曳空白處旋轉'
      : drawTool === 'face'
        ? '依序點選平面的頂點，再點第一個點或按「完成」・Esc 取消'
        : placeMode
          ? '點空白處新增點・拖曳點移動・拖曳 x/y/z 手把沿軸移動'
          : '拖曳旋轉・雙指或滾輪縮放・拖曳點可移動・選取點後拖 x/y/z 手把';

  useEffect(() => {
    if (viewRequestId > 0) controllerRef.current?.goToPreset(useAppStore.getState().view.preset);
  }, [viewRequestId]);

  return (
    <div
      className="viewport"
      ref={containerRef}
      role="region"
      aria-label={`3D 繪圖區，共 ${scene.objects.length} 個物件。拖曳旋轉視角，物件也可在物件清單中編輯。`}
    >
      <div className="viewport-tools" role="group" aria-label="繪製工具">
        <button
          type="button"
          className={`btn place-btn${placeMode ? ' is-on' : ''}`}
          aria-pressed={placeMode}
          onClick={togglePlaceMode}
          title="開啟後，點一下畫面空白處就會在 xy 平面上新增一個點"
        >
          {placeMode ? '放點中' : '＋ 放點'}
        </button>
        <button
          type="button"
          className={`btn place-btn${drawTool === 'line' ? ' is-on' : ''}`}
          aria-pressed={drawTool === 'line'}
          onClick={() => setDrawTool('line')}
          title="開啟後，從一個點拖到另一個點就會畫出線段"
        >
          ╱ 拉線
        </button>
        <button
          type="button"
          className={`btn place-btn${drawTool === 'face' ? ' is-on' : ''}`}
          aria-pressed={drawTool === 'face'}
          onClick={() => setDrawTool('face')}
          title="開啟後，依序點選 3 個以上的點圍出平面"
        >
          ▱ 建面
        </button>
        {drawTool === 'face' && faceDraft.length > 0 && (
          <>
            <button type="button" className="btn place-btn" onClick={() => finishFace()} disabled={faceDraft.length < 3}>
              完成（{faceDraft.length} 點）
            </button>
            <button type="button" className="btn place-btn" onClick={cancelFace}>
              取消
            </button>
          </>
        )}
      </div>
      {drawTool && toolMessage && (
        <p className={`viewport-toast ${toolMessage.ok ? 'is-ok' : 'is-error'}`} role="status">
          {toolMessage.text}
        </p>
      )}
      <p className="viewport-hint" aria-hidden="true">
        {hint}
      </p>
    </div>
  );
}
