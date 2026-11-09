import type { Vec3, ViewPreset } from './types';
import { cross, dot, normalize, scale, sub } from './vec3';

/** World is z-up. Every preset keeps camera.up = +z so OrbitControls never has to be rebuilt. */
export const WORLD_UP: Vec3 = [0, 0, 1];

/**
 * Unit direction from the target toward the camera.
 * `top` is nudged toward +x so that, with z-up, the screen shows x pointing down and y pointing right
 * (the usual orientation of an xy-plane sketch).
 */
const PRESET_DIRECTIONS: Record<ViewPreset, Vec3> = {
  // x drawn toward lower-left, y to the right, z straight up.
  textbook: normalize([2.6, 1, 1.15]),
  front: [1, 0, 0],
  right: [0, 1, 0],
  top: normalize([1e-3, 0, 1]),
};

export const VIEW_PRESET_LABELS: Record<ViewPreset, string> = {
  textbook: '立體視圖',
  front: '前視圖',
  right: '右視圖',
  top: '俯視圖',
};

export function presetDirection(preset: ViewPreset): Vec3 {
  return PRESET_DIRECTIONS[preset];
}

export function presetCameraPosition(preset: ViewPreset, distance: number, target: Vec3 = [0, 0, 0]): Vec3 {
  const d = scale(PRESET_DIRECTIONS[preset], distance);
  return [target[0] + d[0], target[1] + d[1], target[2] + d[2]];
}

export interface ScreenBasis {
  /** Screen-right direction in world space. */
  right: Vec3;
  /** Screen-up direction in world space. */
  up: Vec3;
}

/** Orthographic screen basis for a camera at `position` looking at `target` with world-up +z. */
export function screenBasis(position: Vec3, target: Vec3 = [0, 0, 0]): ScreenBasis {
  const forward = normalize(sub(target, position));
  const right = normalize(cross(forward, WORLD_UP));
  const up = cross(right, forward);
  return { right, up };
}

/** Projects a world direction onto screen axes (x to the right, y upward). */
export function projectDirection(dir: Vec3, basis: ScreenBasis): [number, number] {
  return [dot(dir, basis.right), dot(dir, basis.up)];
}
