import type { RoutedPath } from "./route.js";

export interface ProviderSearchResult {
  id: string;
  provider: string;
  label: string;
  query: string;
  coords: [number, number];
  address?: Record<string, unknown> | null;
}

export interface Provider {
  id: string;
  search(query: string, options?: { limit?: number }): Promise<ProviderSearchResult[]>;
  geocode(query: string): Promise<ProviderSearchResult>;
  route(params: { fromCoords: [number, number]; toCoords: [number, number]; mode: string }): Promise<RoutedPath>;
}

export interface ProviderRegistry {
  defaultProvider: string;
  getProvider(name?: string): Provider;
  listProviders(): string[];
}
