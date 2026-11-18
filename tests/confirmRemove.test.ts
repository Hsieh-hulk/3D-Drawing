import { describe, expect, it, vi } from 'vitest';
import { runCommand } from '../src/model/commands';
import { EMPTY_SCENE, pointByName, type Scene } from '../src/model/scene';
import { createSolid } from '../src/model/solids';
import { confirmRemove, removeConfirmMessage } from '../src/ui/confirmRemove';

function run(scene: Scene, ...inputs: string[]): Scene {
  return inputs.reduce((s, input) => {
    const r = runCommand(input, s);
    if (!r.ok) throw new Error(`"${input}" failed: ${r.error}`);
    return r.scene;
  }, scene);
}

describe('confirmRemove (QA-03)', () => {
  it('asks before removing a point that other objects use', () => {
    const scene = run(EMPTY_SCENE, 'A(0,0,0)', 'B(1,0,0)', '線段 AB');
    const a = pointByName(scene, 'A')!;
    expect(removeConfirmMessage(scene, a)).toContain('1 個物件');
    const ask = vi.fn(() => false);
    expect(confirmRemove(scene, a, ask)).toBe(false);
    expect(ask).toHaveBeenCalledOnce();
    expect(confirmRemove(scene, a, () => true)).toBe(true);
  });

  it('removes a lone point without asking', () => {
    const scene = run(EMPTY_SCENE, 'A(0,0,0)');
    const ask = vi.fn(() => false);
    expect(confirmRemove(scene, pointByName(scene, 'A')!, ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks before removing a solid', () => {
    const r = createSolid(EMPTY_SCENE, 'pyramid', { a: 2, h: 3 });
    if (!r.ok) throw new Error(r.error);
    const solid = r.scene.objects.find((o) => o.kind === 'solid')!;
    expect(removeConfirmMessage(r.scene, solid)).toContain('及其頂點');
  });
});
