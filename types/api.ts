import type { ProviderSearchResult } from "./provider.js";
import type { RouteConfig, PreparedRoute } from "./route.js";
import type { SerializedJob } from "./render.js";

export interface SearchResponse {
  results: ProviderSearchResult[];
}

export interface PreviewResponse {
  route: PreparedRoute;
}

export interface PresetItem {
  id: string;
  source: string;
  name: string;
  updatedAt: string | null;
}

export interface PresetListResponse {
  presets: PresetItem[];
}

export interface PresetDetail {
  id: string;
  source: string;
  name: string;
  route: RouteConfig;
}

export interface PresetSaveRequest {
  name?: string;
  route: RouteConfig;
}

export interface RenderJobsResponse {
  jobs: SerializedJob[];
}

export interface RenderJobCreateResponse {
  job: SerializedJob;
}
