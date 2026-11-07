import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/model/commands';
import { EMPTY_SCENE, type Scene } from '../src/model/scene';
import type { Vec3, ViewPreset } from '../src/model/types';
import { normalize, scale } from '../src/model/vec3';
import { presetCameraPosition, screenBasis } from '../src/model/viewPresets';
import { projectPoint, projectToDrawing } from '../src/projection/project';
import type { ViewCamera } from '../src/projection/types';
import { toPx, type PxTransform } from '../src/render2d/paint';
import {
  axisDragDelta,
  choosePlaneAxis,
  hitTest,
  screenToDrawing,
  snapValue,
  solveOnPlane,
} from '../src/render3d/interaction';
import { DEFAULT_VIEW } from '../src/store/useAppStore';

function camera(preset: ViewPreset): ViewCamera {
  const pos = presetCameraPosition(preset, 30);
  const { right, up } = screenBasis(pos);
  return { right, up, forward: normalize(scale(pos, -1)) };
}

const T: PxTransform = { scale: 50, origin: [0.3, -0.2], cx: 400, cy: 300 };

describe('screen ↔ world', () => {
  it('screenToDrawing inverts toPx', () => {
    const d = screenToDrawing(T, ...toPx(T, [1.25, -2.5]));
    expect(d[0]).toBeCloseTo(1.25);
    expect(d[1]).toBeCloseTo(-2.5);
  });

  it('uses the xy-plane in the textbook view and a vertical plane in the front view', () => {
    expect(choosePlaneAxis(camera('textbook'))).toBe(2);
    expect(choosePlaneAxis(camera('top'))).toBe(2);
    expect(choosePlaneAxis(camera('front'))).toBe(0);
    expect(choosePlaneAxis(camera('right'))).toBe(1);
  });

  it('solveOnPlane recovers a world point from its projection', () => {
    const cam = camera('textbook');
    const w: Vec3 = [1.5, -2, 0.75];
    const back = solveOnPlane(projectPoint(w, cam), cam, 2, 0.75)!;
    back.forEach((v, i) => expect(v).toBeCloseTo(w[i], 9));
  });

  it('returns null when the plane is seen edge-on', () => {
    const cam = camera('front'); // looking along -x: the xy-plane is edge-on
    expect(solveOnPlane([0, 0], cam, 2, 0)).toBeNull();
  });

  it('axis drag converts pointer movement into units along the axis', () => {
    // 40 px per unit along a screen direction; moving 60 px that way is 1.5 units.
    expect(axisDragDelta([36, -48], [24, -32])).toBeCloseTo(1.5);
    // Perpendicular movement does nothing.
    expect(axisDragDelta([32, 24], [24, -32])).toBeCloseTo(0);
  });

  it('snaps to the chosen step without -0 or float noise', () => {
    expect(snapValue(1.26, 0.5)).toBe(1.5);
    expect(snapValue(-0.2, 1)).toBe(0);
    expect(snapValue(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snapValue(1.23456789, 0)).toBe(1.234568);
  });
});

describe('hit testing', () => {
  let scene: Scene = EMPTY_SCENE;
  for (const cmd of ['A(0,0,0)', 'B(3,0,0)', 'C(0,3,0)', '線段 AB', '平面 ABC']) {
    const r = runCommand(cmd, scene);
    if (!r.ok) throw new Error(r.error);
    scene = r.scene;
  }
  const cam = camera('top');
  const drawing = projectToDrawing(scene, cam, { view: { ...DEFAULT_VIEW, showAxes: false, showGrid: false }, selectedId: null });
  const px = (w: Vec3) => toPx(T, projectPoint(w, cam));
  const ids = Object.fromEntries(scene.objects.map((o) => [o.kind === 'point' ? o.name : o.kind, o.id]));

  it('prefers points, then lines, then planes', () => {
    expect(hitTest(drawing, T, ...px([3, 0, 0]), 12)).toEqual({ id: ids.B, kind: 'point' });
    const onSegment = hitTest(drawing, T, ...px([1.5, 0, 0]), 12);
    expect(onSegment?.kind).toBe('line');
    expect(onSegment?.id).toBe(ids.segment);
    expect(hitTest(drawing, T, ...px([0.8, 0.8, 0]), 12)).toEqual({ id: ids.plane, kind: 'plane' });
    expect(hitTest(drawing, T, ...px([4, 4, 0]), 12)).toBeNull();
  });
});
