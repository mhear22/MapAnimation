import type { RouteConfig, PreparedRoute } from "./route.js";

export type RenderStage =
  | "queued"
  | "preparing"
  | "priming_tiles"
  | "capturing_frames"
  | "encoding_video"
  | "completed"
  | "failed";

export interface RenderProgress {
  stage: RenderStage;
  frame?: number;
  totalFrames?: number;
  percent?: number | null;
  seconds?: number;
  durationSeconds?: number;
}

export interface RenderJob {
  id: string;
  payload: { route: RouteConfig };
  status: "queued" | "running" | "completed" | "failed";
  stage: RenderStage;
  progress: RenderProgress;
  error?: string;
  result?: RenderResult;
  createdAt: string;
  updatedAt: string;
}

export interface RenderResult {
  outputPath: string;
  route: PreparedRoute;
}

export interface SerializedJob {
  id: string;
  status: string;
  stage: string;
  error: string | null;
  progress: RenderProgress | null;
  createdAt: string;
  updatedAt: string;
  summary: JobSummary;
  result: SerializedResult | null;
}

export interface JobSummary {
  id: string | null;
  name: string | null;
  startLabel: string;
  endLabel: string;
  mode: string;
  mapType: string;
  output: string | null;
}

export interface SerializedResult {
  outputPath: string;
  outputUrl: string | null;
  routeId: string | null;
}
