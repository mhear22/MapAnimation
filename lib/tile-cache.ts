import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { ensureDir } from "./utils.js";

interface TileProviderConfig {
  templateUrl: string;
  ext: string;
}

const TILE_PROVIDERS: Record<string, TileProviderConfig> = {
  satellite: {
    templateUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ext: "png"
  },
  standard: {
    templateUrl: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ext: "png"
  }
};

interface TileCache {
  handleTileRequest: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    provider: string,
    z: number,
    x: number,
    y: number
  ) => Promise<void>;
  getTile: (provider: string, z: number, x: number, y: number) => Promise<Buffer>;
  cacheDir: string;
}

export function createTileCache({ cacheDir }: { cacheDir?: string } = {}): TileCache {
  const dir = cacheDir ?? path.resolve(process.cwd(), ".tile-cache");
  const inflight = new Map<string, Promise<Buffer>>();

  function getTileProviderConfig(provider: string): TileProviderConfig {
    const config = TILE_PROVIDERS[provider];
    if (!config) {
      throw new Error(`Unknown tile provider "${provider}"`);
    }

    return config;
  }

  function cachePath(provider: string, z: number, x: number, y: number): string {
    const config = getTileProviderConfig(provider);
    return path.join(dir, provider, String(z), String(x), `${y}.${config.ext}`);
  }

  function remoteUrl(provider: string, z: number, x: number, y: number): string {
    return getTileProviderConfig(provider).templateUrl
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
  }

  async function getTile(provider: string, z: number, x: number, y: number): Promise<Buffer> {
    const filePath = cachePath(provider, z, x, y);

    try {
      return await fs.readFile(filePath);
    } catch {
      // cache miss — continue to fetch
    }

    const key = `${provider}/${z}/${x}/${y}`;
    if (inflight.has(key)) {
      return inflight.get(key)!;
    }

    const promise = (async (): Promise<Buffer> => {
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

  async function handleTileRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    provider: string,
    z: number,
    x: number,
    y: number
  ): Promise<void> {
    if (!(provider in TILE_PROVIDERS)) {
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
      response.end((error as Error).message);
    }
  }

  return { handleTileRequest, getTile, cacheDir: dir };
}
