import { describe, expect, it } from 'vitest';
import { clipLineToCube } from '../src/model/geometry';

describe('clipLineToCube', () => {
  it('extends a segment along an axis to the cube faces', () => {
    expect(clipLineToCube([0, 0, 0], [1, 0, 0], 5)).toEqual([
      [-5, 0, 0],
      [5, 0, 0],
    ]);
  });

  it('clips a diagonal line to the corners', () => {
    const r = clipLineToCube([0, 0, 0], [1, 1, 1], 2)!;
    expect(r[0]).toEqual([-2, -2, -2]);
    expect(r[1]).toEqual([2, 2, 2]);
  });

  it('returns null when the line misses the cube or is degenerate', () => {
    expect(clipLineToCube([10, 10, 0], [10, 11, 0], 5)).toBeNull();
    expect(clipLineToCube([1, 1, 1], [1, 1, 1], 5)).toBeNull();
  });
});
