export const APP_VERSION = "0.1.0-alpha.1";
export type Language = "zh" | "en";
export type View = "overview" | "analysis" | "samples" | "results";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Roi {
  id: string;
  laneId: string;
  kind: "band" | "background";
  rect: Rect;
}
export interface Sample {
  id: string;
  label: string;
  group: string;
  experimentalUnitId: string;
  technicalReplicateSetId: string;
}
export interface Lane {
  id: string;
  number: number;
  sampleId: string;
}
export interface Batch {
  id: string;
  label: string;
  date: string;
}
export interface ImageRecord {
  id: string;
  name: string;
  batchId: string;
  membraneId: string;
  protein: string;
  role: "target" | "reference";
  exposureMs: number;
  width: number;
  height: number;
  dataUrl: string;
  hash: string;
  source: "synthetic";
  qc: "normal" | "weak" | "background" | "saturated";
}
export interface Template {
  id: string;
  name: string;
  version: number;
  bandWidth: number;
  bandHeight: number;
  backgroundGap: number;
}
export interface Analysis {
  imageId: string;
  revision: number;
  status: "unreviewed" | "confirmed" | "stale";
  rois: Roi[];
  templateSnapshot: Template;
  referenceImageId: string | null;
  excluded: boolean;
  note: string;
  fixtureSignature: string;
}
export interface Measurement {
  imageId: string;
  sampleId: string;
  bandSum: number;
  area: number;
  backgroundMean: number;
  net: number;
  referenceNet: number;
  ratio: number;
  relative: number;
  demo: true;
}
export interface Project {
  schemaVersion: 1;
  appVersion: string;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  demo: true;
  batches: Batch[];
  samples: Sample[];
  lanes: Lane[];
  images: ImageRecord[];
  template: Template;
  analyses: Analysis[];
  history: Analysis[];
  ui: {
    view: View;
    selectedImageId: string;
    batchFilter: string;
    language: Language;
  };
}
