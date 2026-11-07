import type { SceneController } from './SceneController';

/** The mounted viewport, so UI outside it (the export dialog) can read the current camera. */
export const viewportRegistry: { current: SceneController | null } = { current: null };
