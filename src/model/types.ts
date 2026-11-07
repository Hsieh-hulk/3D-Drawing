export type Vec3 = readonly [number, number, number];

/** Named camera orientations. `textbook` mimics the oblique drawings used in Taiwanese high-school textbooks. */
export type ViewPreset = 'textbook' | 'front' | 'top' | 'right';

export interface ViewSettings {
  preset: ViewPreset;
  showGrid: boolean;
  showAxes: boolean;
  showTickLabels: boolean;
  /** Show "A(1, 2, 3)" instead of just "A" next to each point. */
  showPointCoords: boolean;
  /** Draw hidden edges dashed (textbook style); when false they are omitted. */
  showHiddenLines: boolean;
  /** Grid step points snap to while dragging / placing (0 = off). */
  snap: 0 | 0.5 | 1;
  /** Axes are drawn from -axisRange to +axisRange on every axis. */
  axisRange: number;
}
