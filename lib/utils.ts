import fs from "node:fs/promises";
import path from "node:path";

export interface CliArgs extends Record<string, string | boolean | undefined> {
  config?: string | boolean;
  id?: string | boolean;
  from?: string | boolean;
  to?: string | boolean;
  width?: string | boolean;
  height?: string | boolean;
  fps?: string | boolean;
  duration?: string | boolean;
  overviewPadding?: string | boolean;
  mapType?: string | boolean;
  mode?: string | boolean;
  travelMode?: string | boolean;
  startZoom?: string | boolean;
  endZoom?: string | boolean;
  maxAltitude?: string | boolean;
  peakAltitude?: string | boolean;
  aggressiveness?: string | boolean;
  curvePosition?: string | boolean;
  cameraSmoothing?: string | boolean;
  out?: string | boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const nextToken = argv[index + 1];
    const value: string | boolean =
      nextToken && !nextToken.startsWith("--") ? nextToken : true;
    if (typeof value === "string") {
      index += 1;
    }
    parsed[key] = value;
  }

  return parsed;
}

export function slugify(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function ensureDir(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) {
    return "application/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (filePath.endsWith(".png")) {
    return "image/png";
  }

  if (filePath.endsWith(".mp4")) {
    return "video/mp4";
  }

  return "application/octet-stream";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
