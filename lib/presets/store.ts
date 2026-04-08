import fs from "node:fs/promises";
import path from "node:path";
import { readJson, slugify, writeJson } from "../utils.js";
import type { RouteConfig } from "../../types/index.js";
import type { PresetItem, PresetDetail, PresetSaveRequest } from "../../types/api.js";

interface FilePresetItem extends PresetItem {
  filePath: string;
  updatedAt: string;
}

interface RoutesConfigFile {
  routes: RouteConfig[];
}

export function createPresetStore({ rootDir }: { rootDir: string }) {
  const presetsDir = path.join(rootDir, "presets");
  const routesConfigPath = path.join(rootDir, "routes.json");

  async function listFilePresets(): Promise<FilePresetItem[]> {
    await fs.mkdir(presetsDir, { recursive: true });
    const entries = await fs.readdir(presetsDir, { withFileTypes: true });
    const items: FilePresetItem[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(presetsDir, entry.name);
      const data = await readJson<Record<string, unknown>>(filePath);
      items.push({
        id: `preset:${(data.id as string) ?? entry.name.replace(/\.json$/, "")}`,
        source: "preset",
        name: (data.name as string) ?? (data.id as string) ?? entry.name.replace(/\.json$/, ""),
        filePath,
        updatedAt: (await fs.stat(filePath)).mtime.toISOString()
      });
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function listRouteConfigPresets(): Promise<PresetItem[]> {
    try {
      const parsed = await readJson<RoutesConfigFile>(routesConfigPath);
      return (parsed.routes ?? []).map((route) => ({
        id: `route:${route.id}`,
        source: "route",
        name: route.name ?? route.id ?? "Unnamed",
        updatedAt: null
      }));
    } catch {
      return [];
    }
  }

  return {
    async list(): Promise<PresetItem[]> {
      const [filePresets, routePresets] = await Promise.all([listFilePresets(), listRouteConfigPresets()]);
      return [...routePresets, ...filePresets];
    },

    async get(id: string): Promise<PresetDetail> {
      const [source, rawId] = String(id).split(":");

      if (source === "route") {
        const parsed = await readJson<RoutesConfigFile>(routesConfigPath);
        const match = (parsed.routes ?? []).find((route) => route.id === rawId);
        if (!match) {
          throw new Error(`Unknown route preset "${id}"`);
        }

        return {
          id,
          source,
          name: match.name ?? match.id ?? "Unnamed",
          route: match
        };
      }

      if (source !== "preset") {
        throw new Error(`Unknown preset source "${source}"`);
      }

      const filePath = path.join(presetsDir, `${rawId}.json`);
      const route = await readJson<RouteConfig>(filePath);
      return {
        id,
        source,
        name: route.name ?? rawId,
        route
      };
    },

    async save({ name, route }: PresetSaveRequest): Promise<PresetDetail> {
      const id = route.id ?? slugify(name || `${route.start?.label ?? "route"}-preset`);
      const filePath = path.join(presetsDir, `${id}.json`);
      const payload: RouteConfig & { id: string; name: string } = {
        ...route,
        id,
        name: name ?? route.name ?? id
      };
      await writeJson(filePath, payload);

      return {
        id: `preset:${id}`,
        source: "preset",
        name: payload.name,
        route: payload
      };
    }
  };
}
