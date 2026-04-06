import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./utils.js";

const TILE_PROVIDERS = {
  satellite: {
    templateUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ext: "png"
  },
  standard: {
    templateUrl: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ext: "png"
  }
};

export function createTileCache({ cacheDir } = {}) {
  const dir = cacheDir ?? path.resolve(process.cwd(), ".tile-cache");
  const inflight = new Map();

  function cachePath(provider, z, x, y) {
    return path.join(dir, provider, String(z), String(x), `${y}.${TILE_PROVIDERS[provider].ext}`);
  }

  function remoteUrl(provider, z, x, y) {
    return TILE_PROVIDERS[provider].templateUrl
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
  }

  async function getTile(provider, z, x, y) {
    const filePath = cachePath(provider, z, x, y);

    try {
      return await fs.readFile(filePath);
    } catch {}

    const key = `${provider}/${z}/${x}/${y}`;
    if (inflight.has(key)) {
      return inflight.get(key);
    }

    const promise = (async () => {
      const url = remoteUrl(provider, z, x, y);
      const response = await fetch(url, {
        headers: { "User-Agent": "MapAnim-TileCache/1.0" }
      });
      if (!response.ok) {
        throw new Error(`Tile fetch failed: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, buffer);
      return buffer;
    })();

    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  }

  async function handleTileRequest(request, response, provider, z, x, y) {
    if (!TILE_PROVIDERS[provider]) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Unknown tile provider");
      return;
    }

    try {
      const tile = await getTile(provider, z, x, y);
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400"
      });
      response.end(tile);
    } catch (error) {
      response.writeHead(502, { "Content-Type": "text/plain" });
      response.end(error.message);
    }
  }

  return { handleTileRequest, getTile, cacheDir: dir };
}
