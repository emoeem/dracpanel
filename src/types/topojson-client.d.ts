declare module "topojson-client" {
  export interface Topology {
    type: "Topology";
    objects: Record<string, unknown>;
    arcs: unknown[];
    bbox?: number[];
    transform?: unknown;
  }

  export interface PolygonGeometry {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  }

  export interface TopoFeature {
    type: "Feature";
    id?: string | number;
    properties: Record<string, unknown> | null;
    geometry: PolygonGeometry | null;
  }

  export interface FeatureCollection {
    type: "FeatureCollection";
    features: TopoFeature[];
  }

  export function feature(
    topology: Topology,
    object: unknown,
  ): TopoFeature | FeatureCollection;

  export function mesh(
    topology: Topology,
    object?: unknown,
    filter?: unknown,
  ): unknown;
}
