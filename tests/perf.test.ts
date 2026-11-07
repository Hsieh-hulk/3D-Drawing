import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/model/commands';
import { EMPTY_SCENE, type Scene } from '../src/model/scene';
import { createSolid } from '../src/model/solids';
import { normalize, scale } from '../src/model/vec3';
import { presetCameraPosition, screenBasis } from '../src/model/viewPresets';
import { projectToDrawing } from '../src/projection/project';

describe('projection performance', () => {
  it('re-projects a busy scene (3 solids, 100+ objects, axes and grid) well within a frame budget', () => {
    let scene: Scene = EMPTY_SCENE;
    for (const [t, p] of [
      ['cube', { a: 2 }],
      ['pyramid', { a: 2, h: 3 }],
      ['prism', { a: 2, h: 2 }],
    ] as const) {
      const r = createSolid(scene, t, p);
      if (!r.ok) throw new Error(r.error);
      scene = r.scene;
    }
    const run = (cmd: string) => {
      const r = runCommand(cmd, scene);
      if (!r.ok) throw new Error(`${cmd}: ${r.error}`);
      scene = r.scene;
    };
    for (let i = 0; i < 40; i++) run(`Q${i}(${(i % 7) - 3}, ${((i * 3) % 7) - 3}, ${((i * 5) % 5) - 2})`);
    for (let i = 0; i < 39; i++) run(`Q${i}Q${i + 1}`);
    for (let i = 0; i < 20; i++) run(`線段 Q${i}Q${i + 20}`);
    expect(scene.objects.length).toBeGreaterThan(100);

    const pos = presetCameraPosition('textbook', 30);
    const { right, up } = screenBasis(pos);
    const cam = { right, up, forward: normalize(scale(pos, -1)) };
    const view = {
      preset: 'textbook' as const,
      showGrid: true,
      showAxes: true,
      showTickLabels: true,
      showPointCoords: false,
      showHiddenLines: true,
      snap: 1 as const,
      axisRange: 5,
    };

    projectToDrawing(scene, cam, { view, selectedId: null }); // warm-up
    const runs = 10;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) projectToDrawing(scene, cam, { view, selectedId: null });
    const ms = (performance.now() - t0) / runs;
    console.log(`projectToDrawing: ${ms.toFixed(2)} ms for ${scene.objects.length} objects`);
    expect(ms).toBeLessThan(20); // 50 fps budget; projection is skipped entirely on pan/zoom
  });
});
