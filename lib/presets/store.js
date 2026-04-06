import fs from "node:fs/promises";
import path from "node:path";
import { readJson, slugify, writeJson } from "../utils.js";

export function createPresetStore({ rootDir }) {
  const presetsDir = path.join(rootDir, "presets");
  const routesConfigPath = path.join(rootDir, "routes.json");

  async function listFilePresets() {
    await fs.mkdir(presetsDir, { recursive: true });
    const entries = await fs.readdir(presetsDir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(presetsDir, entry.name);
      const data = await readJson(filePath);
      items.push({
        id: `preset:${data.id ?? entry.name.replace(/\.json$/, "")}`,
        source: "preset",
        name: data.name ?? data.id ?? entry.name.replace(/\.json$/, ""),
        filePath,
        updatedAt: (await fs.stat(filePath)).mtime.toISOString()
      });
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function listRouteConfigPresets() {
    try {
      const parsed = await readJson(routesConfigPath);
      return (parsed.routes ?? []).map((route) => ({
        id: `route:${route.id}`,
        source: "route",
        name: route.name ?? route.id,
        updatedAt: null
      }));
    } catch {
      return [];
    }
  }

  return {
    async list() {
      const [filePresets, routePresets] = await Promise.all([listFilePresets(), listRouteConfigPresets()]);
      return [...routePresets, ...filePresets];
    },

    async get(id) {
      const [source, rawId] = String(id).split(":");

      if (source === "route") {
        const parsed = await readJson(routesConfigPath);
        const match = (parsed.routes ?? []).find((route) => route.id === rawId);
        if (!match) {
          throw new Error(`Unknown route preset "${id}"`);
        }

        return {
          id,
          source,
          name: match.name ?? match.id,
          route: match
        };
      }

      if (source !== "preset") {
        throw new Error(`Unknown preset source "${source}"`);
      }

      const filePath = path.join(presetsDir, `${rawId}.json`);
      const route = await readJson(filePath);
      return {
        id,
        source,
        name: route.name ?? rawId,
        route
      };
    },

    async save({ name, route }) {
      const id = route.id ?? slugify(name || `${route.start?.label ?? "route"}-preset`);
      const filePath = path.join(presetsDir, `${id}.json`);
      const payload = {
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
