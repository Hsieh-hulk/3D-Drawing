import type { Vec3 } from '../model/types';

/** 2D point in drawing space: world units projected on the screen basis, x to the right, y UP. */
export type Pt2 = [number, number];

/** Orthographic camera described only by its basis (zoom/pan are applied later by each renderer). */
export interface ViewCamera {
  right: Vec3;
  up: Vec3;
  /** Viewing direction, from the camera into the scene. */
  forward: Vec3;
}

export type LineRole = 'grid' | 'axis' | 'edge' | 'segment' | 'vector' | 'guide' | 'plane-edge';

export interface LinePrim {
  type: 'line';
  a: Pt2;
  b: Pt2;
  hidden: boolean;
  color: string;
  role: LineRole;
  objectId?: string;
  selected?: boolean;
  /** Renderer pulls the `b` end back by this many px (so arrowheads cover the line end cleanly). */
  trimEndPx?: number;
}

export interface ArrowPrim {
  type: 'arrow';
  tip: Pt2;
  /** Unit direction in drawing space (pointing toward the tip). */
  dir: Pt2;
  color: string;
  role: 'axis' | 'vector';
  hidden: boolean;
  objectId?: string;
  selected?: boolean;
}

export interface TickPrim {
  type: 'tick';
  p: Pt2;
  /** Unit direction across the axis in drawing space. */
  across: Pt2;
  color: string;
}

export interface PolygonPrim {
  type: 'polygon';
  pts: Pt2[];
  color: string;
  opacity: number;
  depth: number;
  objectId?: string;
  selected?: boolean;
}

export interface PointPrim {
  type: 'point';
  p: Pt2;
  color: string;
  hidden: boolean;
  objectId?: string;
  selected?: boolean;
}

export type LabelStyle = 'point' | 'vector' | 'axis' | 'tick' | 'origin';

export interface LabelPrim {
  type: 'label';
  p: Pt2;
  text: string;
  /** Optional smaller text after the main one, e.g. coordinates "(1, 2, 3)". */
  sub?: string;
  style: LabelStyle;
  color: string;
  /** Offset of the label centre from `p`, in px (x right, y UP). */
  offsetPx: Pt2;
  selected?: boolean;
}

export type Prim = LinePrim | ArrowPrim | TickPrim | PolygonPrim | PointPrim | LabelPrim;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Drawing {
  prims: Prim[];
  /** Bounds of the geometry (labels excluded, they are sized in px by the renderer). */
  bounds: Bounds;
}
