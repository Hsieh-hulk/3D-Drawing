import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { formatNumber } from '../model/expr';
import { coordsValue, findPoint, type Scene } from '../model/scene';
import type { Vec3, ViewPreset, ViewSettings } from '../model/types';
import { WORLD_UP, presetCameraPosition } from '../model/viewPresets';
import { axisStep } from '../projection/axisScale';
import { AXIS_COLORS, projectAutoAxes, projectPoint, projectToDrawing, sceneOccluders, type AxisWindow } from '../projection/project';
import type { Bounds, Drawing, Prim, Pt2, ViewCamera } from '../projection/types';
import type { OccluderSet } from '../projection/visibility';
import { CanvasPainter } from '../render2d/canvasRenderer';
import { DEFAULT_STYLE, paintDrawing, toPx, type PxTransform } from '../render2d/paint';
import { axisDragDelta, choosePlaneAxis, hitTest, screenToDrawing, snapValue, solveOnPlane } from './interaction';

const CAMERA_DISTANCE = 30;
const TRANSITION_MS = 350;
const EXPORT_PX_PER_UNIT = 60;
const HANDLE_LEN_PX = 48;
const TAP_SLOP_PX = 6;
const DRAG_START_PX = 3;
/** Zoom range of the interactive view (wide, Desmos-style: the axes rescale themselves). */
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 500;
/** Exports keep the zoom range they always had, so a far zoom never yields a tiny or huge file. */
const EXPORT_MIN_ZOOM = 0.3;
const EXPORT_MAX_ZOOM = 6;
const AXIS_KEYS = ['x', 'y', 'z'] as const;
const preventDefault = (e: Event) => e.preventDefault();

export interface InteractionCallbacks {
  onSelect(id: string | null): void;
  /** Called once when a drag actually starts moving (one undo entry per drag). */
  onDragStart(): void;
  onDragMove(id: string, pos: Vec3): void;
  /** Tap on empty space in place mode. */
  onPlace(pos: Vec3): void;
}

interface DragState {
  pointerId: number;
  id: string;
  /** 'axis' = along one coordinate axis (handle); 'plane' = within a coordinate plane (point body). */
  mode: 'axis' | 'plane';
  axis: 0 | 1 | 2;
  startPos: Vec3;
  startPx: Pt2;
  startPlanePos: Vec3 | null;
  lastPos: Vec3;
  moved: boolean;
}

/**
 * Interactive view. Three.js supplies only the orthographic camera and OrbitControls (rotate / pinch / pan);
 * all drawing goes through projectToDrawing → Canvas 2D, the same primitives the exporters use.
 * Pointer events that start on a point or a handle are intercepted (capture phase) for dragging;
 * everything else falls through to OrbitControls.
 */
export class SceneController {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera: THREE.OrthographicCamera;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private frameId = 0;
  private transition: { from: THREE.Vector3; to: THREE.Vector3; start: number } | null = null;
  private dirty = true;
  private width = 0;
  private height = 0;

  private scene: Scene = { objects: [] };
  private selectedId: string | null = null;
  private view: ViewSettings | null = null;
  private placeMode = false;

  /**
   * Cached projection of the content (everything but axes and grid); rebuilt only when the camera
   * orientation, the content, or the zoom bucket that sizes infinite lines changes.
   */
  private content: { key: string; drawing: Drawing; occluders: OccluderSet } | null = null;
  /** Auto axes + grid; they depend on the visible window, so they are rebuilt on pan/zoom (cheap). */
  private axes: { key: string; prims: Prim[] } | null = null;
  /** Content + axes, what is painted and hit-tested. */
  private drawing: Drawing | null = null;
  private contentVersion = 0;

  private readonly activePointers = new Set<number>();
  private drag: DragState | null = null;
  private tap: { pointerId: number; x: number; y: number; multi: boolean } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: InteractionCallbacks,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.up.set(...WORLD_UP);
    this.camera.position.set(...presetCameraPosition('textbook', CAMERA_DISTANCE));
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minZoom = MIN_ZOOM;
    this.controls.maxZoom = MAX_ZOOM;
    this.controls.zoomToCursor = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('start', () => {
      this.transition = null;
    });
    this.controls.addEventListener('change', () => {
      this.dirty = true;
    });

    // Capture phase on the container runs before OrbitControls' listeners on the canvas.
    container.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    container.addEventListener('pointermove', this.onPointerMove, { capture: true });
    container.addEventListener('pointerup', this.onPointerUp, { capture: true });
    container.addEventListener('pointercancel', this.onPointerCancel, { capture: true });
    // iPad / phones: a long press must never start text selection or open the callout menu.
    container.addEventListener('selectstart', preventDefault);
    container.addEventListener('contextmenu', preventDefault);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  syncScene(scene: Scene, selectedId: string | null): void {
    this.scene = scene;
    this.selectedId = selectedId;
    this.contentVersion++;
    this.dirty = true;
  }

  applySettings(view: ViewSettings): void {
    this.view = view;
    this.contentVersion++;
    this.dirty = true;
  }

  setPlaceMode(on: boolean): void {
    this.placeMode = on;
    this.container.classList.toggle('is-placing', on);
    this.dirty = true;
  }

  /** Smoothly moves the camera to a preset orientation and resets zoom/pan. */
  goToPreset(preset: ViewPreset, animate = true): void {
    // Flush leftover damping momentum from a previous drag. Near the top-view pole even a tiny
    // residual azimuth delta visibly rotates the whole view, so it must be zeroed before moving.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    const to = new THREE.Vector3(...presetCameraPosition(preset, CAMERA_DISTANCE));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!animate || reduceMotion) {
      this.camera.position.copy(to);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.transition = { from: this.camera.position.clone(), to, start: performance.now() };
  }

  /** Camera basis (right / up / forward) of the current view, used by the projection and exporters. */
  getViewCamera(): ViewCamera {
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorld.elements;
    const right: Vec3 = [e[0], e[1], e[2]];
    const up: Vec3 = [e[4], e[5], e[6]];
    const forward: Vec3 = [-e[8], -e[9], -e[10]];
    return { right, up, forward };
  }

  /**
   * Camera orientation plus a device-independent scale (base × the user's zoom), so the same figure
   * exports at the same size from a phone, an iPad or a desktop window.
   */
  getExportContext(): { cam: ViewCamera; pxPerUnit: number } {
    const zoom = Math.min(EXPORT_MAX_ZOOM, Math.max(EXPORT_MIN_ZOOM, this.camera.zoom));
    return { cam: this.getViewCamera(), pxPerUnit: EXPORT_PX_PER_UNIT * zoom };
  }

  /**
   * Development aid: rotates the camera `frames` steps around the z-axis and times each full frame
   * (re-projection with hidden-line classification + canvas paint), then restores the view.
   */
  measureRotation(frames = 120): { objects: number; frames: number; avgMs: number; p95Ms: number; maxMs: number } {
    const saved = this.camera.position.clone();
    const times: number[] = [];
    const step = (2 * Math.PI) / frames;
    for (let i = 0; i < frames; i++) {
      this.camera.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), step);
      this.camera.lookAt(this.controls.target);
      const t0 = performance.now();
      this.render();
      times.push(performance.now() - t0);
    }
    this.camera.position.copy(saved);
    this.camera.lookAt(this.controls.target);
    this.dirty = true;
    times.sort((a, b) => a - b);
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      objects: this.scene.objects.length,
      frames,
      avgMs: round(times.reduce((s, v) => s + v, 0) / frames),
      p95Ms: round(times[Math.floor(frames * 0.95)]),
      maxMs: round(times[frames - 1]),
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.container.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.container.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    this.container.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    this.container.removeEventListener('pointercancel', this.onPointerCancel, { capture: true });
    this.container.removeEventListener('selectstart', preventDefault);
    this.container.removeEventListener('contextmenu', preventDefault);
    this.container.classList.remove('is-placing', 'is-hovering');
    this.canvas.remove();
  }

  // ---------------------------------------------------------------- geometry helpers

  private pxPerUnit(): number {
    const h = this.height || 600;
    return (this.camera.zoom * h) / (this.camera.top - this.camera.bottom);
  }

  private transform(cam: ViewCamera = this.getViewCamera()): PxTransform {
    const pos = this.camera.position;
    return {
      scale: this.pxPerUnit(),
      origin: projectPoint([pos.x, pos.y, pos.z], cam),
      cx: this.width / 2,
      cy: this.height / 2,
    };
  }

  /** Drawing-space rectangle currently on screen. */
  private visibleRect(t: PxTransform = this.transform()): Bounds {
    const hw = (this.width || 1) / 2 / t.scale;
    const hh = (this.height || 1) / 2 / t.scale;
    return { minX: t.origin[0] - hw, maxX: t.origin[0] + hw, minY: t.origin[1] - hh, maxY: t.origin[1] + hh };
  }

  /** World-space radius around the origin that covers the whole screen (at least axisRange). */
  private viewRadius(t: PxTransform = this.transform()): number {
    const r = this.visibleRect(t);
    const corner = Math.max(Math.hypot(r.minX, r.minY), Math.hypot(r.maxX, r.minY), Math.hypot(r.minX, r.maxY), Math.hypot(r.maxX, r.maxY));
    return Math.max(this.view?.axisRange ?? 5, corner);
  }

  /** Points may be dragged / placed this far from the origin (twice what is on screen). */
  private coordLimit(): number {
    return this.viewRadius() * 2;
  }

  private local(e: PointerEvent): Pt2 {
    const r = this.container.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** The selected point, when it can be dragged (visible and not the fixed origin O). */
  private draggableSelected(): { id: string; pos: Vec3 } | null {
    if (!this.selectedId) return null;
    const p = findPoint(this.scene, this.selectedId);
    if (!p || !p.visible || p.name === 'O') return null;
    return { id: p.id, pos: coordsValue(p.coords) };
  }

  /** Screen geometry of the three axis handles of the selected point. */
  private handles(): { axis: 0 | 1 | 2; base: Pt2; knob: Pt2; pxPerUnit: Pt2 }[] {
    const sel = this.draggableSelected();
    if (!sel) return [];
    const cam = this.getViewCamera();
    const t = this.transform(cam);
    const base = toPx(t, projectPoint(sel.pos, cam));
    const out: { axis: 0 | 1 | 2; base: Pt2; knob: Pt2; pxPerUnit: Pt2 }[] = [];
    for (const axis of [0, 1, 2] as const) {
      const unit: Vec3 = [0, 0, 0].map((_, i) => sel.pos[i] + (i === axis ? 1 : 0)) as unknown as Vec3;
      const tip = toPx(t, projectPoint(unit, cam));
      const v: Pt2 = [tip[0] - base[0], tip[1] - base[1]];
      const len = Math.hypot(v[0], v[1]);
      if (len < 8) continue; // axis points almost straight at the viewer: not draggable from here
      out.push({ axis, base, knob: [base[0] + (v[0] / len) * HANDLE_LEN_PX, base[1] + (v[1] / len) * HANDLE_LEN_PX], pxPerUnit: v });
    }
    return out;
  }

  /** Snap step: the chosen grid step, refined to the current tick step when zoomed in (0 = off). */
  private snap(): number {
    const s = this.view?.snap ?? 1;
    if (s === 0) return 0;
    return Math.min(s, axisStep(this.getViewCamera(), this.pxPerUnit()));
  }

  // ---------------------------------------------------------------- pointer handling

  private onPointerDown = (e: PointerEvent): void => {
    if (e.target !== this.canvas) return; // overlay buttons inside the viewport handle their own clicks
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size > 1) {
      if (this.tap) this.tap.multi = true;
      return; // second finger: let OrbitControls pinch/pan (an active point drag simply continues)
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const [x, y] = this.local(e);
    const touch = e.pointerType !== 'mouse';

    // 1. Axis handle of the selected point.
    const handle = this.handles().find((h) => Math.hypot(h.knob[0] - x, h.knob[1] - y) <= (touch ? 24 : 14));
    if (handle) {
      const sel = this.draggableSelected()!;
      this.startDrag(e, { id: sel.id, mode: 'axis', axis: handle.axis, startPos: sel.pos, startPx: [x, y], startPlanePos: null });
      return;
    }

    // 2. A point: select it and drag it within a coordinate plane.
    if (this.drawing) {
      const hit = hitTest(this.drawing, this.transform(), x, y, touch ? 22 : 12);
      if (hit?.kind === 'point') {
        const p = findPoint(this.scene, hit.id);
        this.callbacks.onSelect(hit.id);
        if (p && p.name !== 'O') {
          const pos = coordsValue(p.coords);
          const cam = this.getViewCamera();
          const axis = choosePlaneAxis(cam);
          const startPlanePos = solveOnPlane(screenToDrawing(this.transform(cam), x, y), cam, axis, pos[axis]);
          this.startDrag(e, { id: p.id, mode: 'plane', axis, startPos: pos, startPx: [x, y], startPlanePos });
        } else {
          e.stopPropagation(); // tapping O selects it without rotating the view
        }
        return;
      }
    }

    // 3. Anything else: OrbitControls rotates; remember the position to detect a tap on release.
    this.tap = { pointerId: e.pointerId, x, y, multi: false };
  };

  private startDrag(e: PointerEvent, d: Omit<DragState, 'pointerId' | 'lastPos' | 'moved'>): void {
    e.stopPropagation();
    e.preventDefault();
    try {
      this.container.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone (e.g. released during the same frame): the drag still works without capture */
    }
    this.drag = { ...d, pointerId: e.pointerId, lastPos: d.startPos, moved: false };
    this.dirty = true;
  }

  private onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) {
      if (e.pointerType === 'mouse' && e.buttons === 0) this.updateHover(e);
      return;
    }
    e.stopPropagation();
    const [x, y] = this.local(e);
    if (!d.moved) {
      if (Math.hypot(x - d.startPx[0], y - d.startPx[1]) < DRAG_START_PX) return;
      d.moved = true;
      this.callbacks.onDragStart();
    }
    const step = this.snap();
    const next = [...d.startPos] as [number, number, number];
    if (d.mode === 'axis') {
      const h = this.handles().find((q) => q.axis === d.axis);
      if (!h) return;
      next[d.axis] = snapValue(d.startPos[d.axis] + axisDragDelta([x - d.startPx[0], y - d.startPx[1]], h.pxPerUnit), step);
    } else {
      if (!d.startPlanePos) return;
      const cam = this.getViewCamera();
      const cur = solveOnPlane(screenToDrawing(this.transform(cam), x, y), cam, d.axis, d.startPos[d.axis]);
      if (!cur) return;
      for (let i = 0; i < 3; i++) {
        if (i !== d.axis) next[i] = snapValue(d.startPos[i] + cur[i] - d.startPlanePos[i], step);
      }
    }
    // Keep points inside a sane range so a wild drag cannot fling them out of view.
    const limit = this.coordLimit();
    for (let i = 0; i < 3; i++) next[i] = Math.max(-limit, Math.min(limit, next[i]));
    if (next.every((v, i) => v === d.lastPos[i])) return;
    d.lastPos = next;
    this.callbacks.onDragMove(d.id, next);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    const d = this.drag;
    if (d && e.pointerId === d.pointerId) {
      e.stopPropagation();
      if (this.container.hasPointerCapture(e.pointerId)) this.container.releasePointerCapture(e.pointerId);
      this.drag = null;
      this.dirty = true;
      return;
    }
    const t = this.tap;
    if (t && e.pointerId === t.pointerId) {
      this.tap = null;
      const [x, y] = this.local(e);
      if (!t.multi && Math.hypot(x - t.x, y - t.y) < TAP_SLOP_PX) this.handleTap(x, y, e.pointerType !== 'mouse');
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.drag?.pointerId === e.pointerId) this.drag = null;
    if (this.tap?.pointerId === e.pointerId) this.tap = null;
    this.dirty = true;
  };

  private handleTap(x: number, y: number, touch: boolean): void {
    const hit = this.drawing ? hitTest(this.drawing, this.transform(), x, y, touch ? 22 : 12) : null;
    if (hit) {
      this.callbacks.onSelect(hit.id);
      return;
    }
    if (this.placeMode) {
      const cam = this.getViewCamera();
      const axis = choosePlaneAxis(cam);
      const pos = solveOnPlane(screenToDrawing(this.transform(cam), x, y), cam, axis, 0);
      const limit = this.coordLimit();
      if (pos && pos.every((v) => Math.abs(v) <= limit)) {
        this.callbacks.onPlace(pos.map((v) => snapValue(v, this.snap())) as unknown as Vec3);
        return;
      }
    }
    this.callbacks.onSelect(null);
  }

  private updateHover(e: PointerEvent): void {
    const [x, y] = this.local(e);
    const overHandle = this.handles().some((h) => Math.hypot(h.knob[0] - x, h.knob[1] - y) <= 14);
    const hit = !overHandle && this.drawing ? hitTest(this.drawing, this.transform(), x, y, 12) : null;
    this.container.classList.toggle('is-hovering', overHandle || hit?.kind === 'point');
  }

  // ---------------------------------------------------------------- rendering

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.width = w;
    this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Frustum fits the axis range in the shorter dimension; OrbitControls only needs the aspect to be right.
    const half = Math.max(this.view?.axisRange ?? 5, 3) * 1.25;
    const aspect = w / h;
    if (aspect >= 1) {
      this.camera.left = -half * aspect;
      this.camera.right = half * aspect;
      this.camera.top = half;
      this.camera.bottom = -half;
    } else {
      this.camera.left = -half;
      this.camera.right = half;
      this.camera.top = half / aspect;
      this.camera.bottom = -half / aspect;
    }
    this.camera.updateProjectionMatrix();
    // Resizing the canvas clears it. ResizeObserver runs after layout but before paint, so redraw right
    // here; waiting for the next animation frame would show one blank frame per resize, which flickers
    // continuously while the bottom sheet is being dragged. The cached projection is reused (only the
    // pixel transform changed), so this is cheap.
    this.render();
    this.dirty = false;
  }

  private render(): void {
    if (!this.view || this.width === 0) return;
    const cam = this.getViewCamera();
    const t = this.transform(cam);
    // Infinite lines are clipped to a cube sized by a power-of-two bucket of the visible radius, so the
    // content is re-projected only when zooming crosses a doubling, not on every frame.
    const lineExtent = Math.pow(2, Math.ceil(Math.log2(this.viewRadius(t) * 1.6)));
    const camKey = `${cam.forward.map((v) => v.toFixed(6)).join(',')}|${cam.up.map((v) => v.toFixed(6)).join(',')}`;
    const contentKey = `${this.contentVersion}|${camKey}|${lineExtent}`;
    let rebuilt = false;
    if (!this.content || this.content.key !== contentKey) {
      const occluders = sceneOccluders(this.scene, cam);
      const drawing = projectToDrawing(this.scene, cam, { view: this.view, selectedId: this.selectedId, axes: 'none', lineExtent, occluders });
      this.content = { key: contentKey, drawing, occluders };
      rebuilt = true;
    }
    const win: AxisWindow = { rect: this.visibleRect(t), pxPerUnit: t.scale };
    const axesKey = `${contentKey}|${win.pxPerUnit}|${win.rect.minX},${win.rect.minY},${win.rect.maxX},${win.rect.maxY}`;
    if (!this.axes || this.axes.key !== axesKey) {
      this.axes = { key: axesKey, prims: projectAutoAxes(cam, this.view, this.content.occluders, win) };
      rebuilt = true;
    }
    if (rebuilt || !this.drawing) {
      this.drawing = { prims: [...this.axes.prims, ...this.content.drawing.prims], bounds: this.content.drawing.bounds };
    }

    const dpr = this.canvas.width / this.width;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.width, this.height);
    const painter = new CanvasPainter(ctx);
    paintDrawing(painter, this.drawing, t, { ...DEFAULT_STYLE, showHiddenLines: this.view.showHiddenLines });
    this.paintOverlay(ctx);
  }

  /** Screen-only UI on top of the drawing (never exported): axis handles and the live coordinate readout. */
  private paintOverlay(ctx: CanvasRenderingContext2D): void {
    const handles = this.handles();
    for (const h of handles) {
      const color = AXIS_COLORS[AXIS_KEYS[h.axis]];
      const active = this.drag?.mode === 'axis' && this.drag.axis === h.axis;
      ctx.globalAlpha = this.drag && !active ? 0.35 : 1;
      ctx.beginPath();
      ctx.moveTo(h.base[0], h.base[1]);
      ctx.lineTo(h.knob[0], h.knob[1]);
      ctx.setLineDash([]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.knob[0], h.knob[1], active ? 9 : 7.5, 0, Math.PI * 2);
      ctx.fillStyle = active ? color : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.font = 'italic 600 13px "Times New Roman", serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ux = (h.knob[0] - h.base[0]) / HANDLE_LEN_PX;
      const uy = (h.knob[1] - h.base[1]) / HANDLE_LEN_PX;
      ctx.fillText(AXIS_KEYS[h.axis], h.knob[0] + ux * 15, h.knob[1] + uy * 15);
      ctx.globalAlpha = 1;
    }

    // Coordinate readout while dragging.
    if (this.drag?.moved) {
      const p = findPoint(this.scene, this.drag.id);
      const base = handles[0]?.base;
      if (p && base) {
        const text = `${p.name}(${p.coords.map((c) => formatNumber(c.value)).join(', ')})`;
        ctx.font = '600 13px system-ui, sans-serif';
        const w = ctx.measureText(text).width + 16;
        const x = Math.min(Math.max(base[0] - w / 2, 4), this.width - w - 4);
        const y = Math.max(base[1] - 44, 4);
        ctx.fillStyle = 'rgba(29, 35, 43, 0.88)';
        ctx.beginPath();
        ctx.roundRect(x, y, w, 24, 6);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 8, y + 12.5);
      }
    }
  }

  private loop = (): void => {
    this.frameId = requestAnimationFrame(this.loop);
    if (this.transition) {
      const tt = Math.min((performance.now() - this.transition.start) / TRANSITION_MS, 1);
      const eased = 1 - Math.pow(1 - tt, 3);
      const p = this.transition.from.clone().lerp(this.transition.to, eased);
      p.setLength(CAMERA_DISTANCE); // stay on the sphere so the view never clips
      this.camera.position.copy(p);
      if (tt >= 1) this.transition = null;
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
  };
}
