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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const store = useAppStore.getState;
    const controller = new SceneController(container, {
      onSelect: (id) => store().select(id),
      onDragStart: () => store().beginDrag(),
      onDragMove: (id, pos) => store().movePointLive(id, pos),
      onPlace: (pos) => store().addPointAt(pos),
    });
    controllerRef.current = controller;
    viewportRegistry.current = controller;
    const state = store();
    controller.applySettings(state.view);
    controller.syncScene(state.scene, state.selectedId);
    controller.setPlaceMode(state.placeMode);
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
    if (viewRequestId > 0) controllerRef.current?.goToPreset(useAppStore.getState().view.preset);
  }, [viewRequestId]);

  return (
    <div
      className="viewport"
      ref={containerRef}
      role="region"
      aria-label={`3D 繪圖區，共 ${scene.objects.length} 個物件。拖曳旋轉視角，物件也可在物件清單中編輯。`}
    >
      <button
        type="button"
        className={`btn place-btn${placeMode ? ' is-on' : ''}`}
        aria-pressed={placeMode}
        onClick={togglePlaceMode}
        title="開啟後，點一下畫面空白處就會在 xy 平面上新增一個點"
      >
        {placeMode ? '放點中：點一下畫面新增點' : '＋ 點一下放點'}
      </button>
      <p className="viewport-hint" aria-hidden="true">
        {placeMode
          ? '點空白處新增點・拖曳點移動・拖曳 x/y/z 手把沿軸移動'
          : '拖曳旋轉・雙指或滾輪縮放・拖曳點可移動・選取點後拖 x/y/z 手把'}
      </p>
    </div>
  );
}
