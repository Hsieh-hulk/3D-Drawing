import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/model/types';
import { presetCameraPosition, projectDirection, screenBasis } from '../src/model/viewPresets';

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

describe('view presets', () => {
  it('textbook view draws x toward lower-left, y to the right and z straight up', () => {
    const basis = screenBasis(presetCameraPosition('textbook', 30));
    const [xx, xy] = projectDirection(X, basis);
    const [yx, yy] = projectDirection(Y, basis);
    const [zx, zy] = projectDirection(Z, basis);

    expect(xx).toBeLessThan(0); // left
    expect(xy).toBeLessThan(0); // down
    expect(yx).toBeGreaterThan(0.9); // mostly to the right
    expect(Math.abs(yy)).toBeLessThan(0.25); // nearly horizontal
    expect(Math.abs(zx)).toBeLessThan(1e-9); // vertical
    expect(zy).toBeGreaterThan(0.8);
  });

  it('top view shows x pointing down and y pointing right', () => {
    const basis = screenBasis(presetCameraPosition('top', 30));
    const [xx, xy] = projectDirection(X, basis);
    const [yx, yy] = projectDirection(Y, basis);
    expect(xy).toBeLessThan(-0.99);
    expect(Math.abs(xx)).toBeLessThan(1e-6);
    expect(yx).toBeGreaterThan(0.99);
    expect(Math.abs(yy)).toBeLessThan(1e-6);
  });

  it('front view (from +x) shows y right and z up', () => {
    const basis = screenBasis(presetCameraPosition('front', 30));
    expect(projectDirection(Y, basis)[0]).toBeCloseTo(1);
    expect(projectDirection(Z, basis)[1]).toBeCloseTo(1);
  });

  it('right view (from +y) shows x to the left and z up', () => {
    const basis = screenBasis(presetCameraPosition('right', 30));
    expect(projectDirection(X, basis)[0]).toBeCloseTo(-1);
    expect(projectDirection(Z, basis)[1]).toBeCloseTo(1);
  });
});
