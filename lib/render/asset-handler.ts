import fs from "node:fs/promises";
import fsStat from "node:fs";
import path from "node:path";
import http from "node:http";
import { createTileCache } from "../tile-cache.js";
import { contentTypeFor } from "../utils.js";

interface TileMatch {
  provider: string;
  z: number;
  x: number;
  y: number;
}

interface ResolveRenderAssetPathOptions {
  rootDir: string;
  webDir: string;
  mountPath?: string;
  allowOutput?: boolean;
}

interface CreateRenderAssetHandlerOptions {
  rootDir: string;
  webDir: string;
  mountPath?: string;
  allowOutput?: boolean;
  tileCache?: ReturnType<typeof createTileCache>;
}

function normalizeMountPath(mountPath: string = "/"): string {
  if (!mountPath || mountPath === "/") {
    return "";
  }

  return mountPath.endsWith("/") ? mountPath.slice(0, -1) : mountPath;
}

export function safeResolve(basePath: string, requestedPath: string): string {
  const resolved = path.resolve(basePath, `.${requestedPath}`);
  if (!resolved.startsWith(basePath)) {
    throw new Error("Path escapes base directory");
  }

  return resolved;
}

async function serveFile(response: http.ServerResponse, filePath: string): Promise<void> {
  const data = await fs.readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypeFor(filePath)
  });
  response.end(data);
}

function sendNotFound(response: http.ServerResponse, pathname: string): void {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(`Missing asset: ${pathname}`);
}

export function matchTileRequest(pathname: string): TileMatch | null {
  const match = pathname.match(/^\/tiles\/(\w+)\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) {
    return null;
  }

  const [, provider, z, x, y] = match;
  return {
    provider,
    z: Number(z),
    x: Number(x),
    y: Number(y)
  };
}

export function resolveRenderAssetPath(
  pathname: string,
  options: ResolveRenderAssetPathOptions
): string | null {
  const {
    rootDir,
    webDir,
    mountPath = "/",
    allowOutput = false
  } = options;
  const normalizedMountPath = normalizeMountPath(mountPath);
  const renderIndexPath = normalizedMountPath ? `${normalizedMountPath}/` : "/";
  const renderHtmlPath = normalizedMountPath ? `${normalizedMountPath}/index.html` : "/index.html";
  const renderScriptPath = normalizedMountPath ? `${normalizedMountPath}/renderer.js` : "/renderer.js";

  if (pathname === renderIndexPath || pathname === renderHtmlPath) {
    return path.join(webDir, "index.html");
  }

  if (pathname === renderScriptPath) {
    return path.join(webDir, "renderer.js");
  }

  if (pathname.startsWith("/node_modules/")) {
    return safeResolve(rootDir, pathname);
  }

  if (allowOutput && pathname.startsWith("/output/")) {
    return safeResolve(rootDir, pathname);
  }

  return null;
}

export function createRenderAssetHandler(options: CreateRenderAssetHandlerOptions = {} as CreateRenderAssetHandlerOptions): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  pathnameInput?: string
) => Promise<boolean> {
  const {
    rootDir,
    webDir,
    mountPath = "/",
    allowOutput = false,
    tileCache = createTileCache()
  } = options;

  return async function handleRenderAssetRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    pathnameInput?: string
  ): Promise<boolean> {
    const pathname = pathnameInput ?? new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const tileRequest = matchTileRequest(pathname);

    if (tileRequest) {
      await tileCache.handleTileRequest(
        request,
        response,
        tileRequest.provider,
        tileRequest.z,
        tileRequest.x,
        tileRequest.y
      );
      return true;
    }

    const filePath = resolveRenderAssetPath(pathname, {
      rootDir,
      webDir,
      mountPath,
      allowOutput
    });

    if (!filePath) {
      return false;
    }

    try {
      await serveFile(response, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT" || (error as NodeJS.ErrnoException)?.code === "ENOTDIR") {
        sendNotFound(response, pathname);
        return true;
      }

      throw error;
    }

    return true;
  };
}
