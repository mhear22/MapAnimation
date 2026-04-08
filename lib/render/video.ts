import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { buildOutputPath, prepareRoute } from "../routes.js";
import { ensureDir, sleep } from "../utils.js";
import type { RouteConfig, PreparedRoute, RenderProgress, RenderResult } from "../../types/index.js";
import type { ProviderRegistry, RendererWindow } from "../../types/index.js";

interface FfmpegProgressOptions {
  cwd: string;
  durationSeconds: number;
  onProgress?: (progress: Partial<RenderProgress>) => void;
}

interface RenderRouteToVideoOptions {
  rootDir: string;
  renderBaseUrl: string;
  providerRegistry?: ProviderRegistry;
  onProgress?: (progress: Partial<RenderProgress>) => void;
}

async function runFfmpegWithProgress(
  args: string[],
  { cwd, durationSeconds, onProgress }: FfmpegProgressOptions
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn("ffmpeg", args, { cwd });

    let buffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const [key, rawValue] = line.split("=");
        if (!key) {
          continue;
        }

        if (key === "out_time_ms" || key === "out_time_us") {
          const value = Number(rawValue || 0);
          if (!Number.isFinite(value) || value <= 0) {
            continue;
          }
          const seconds = value / 1_000_000;
          const percent = durationSeconds > 0 ? Math.min(100, (seconds / durationSeconds) * 100) : null;
          onProgress?.({
            stage: "encoding_video",
            seconds,
            durationSeconds,
            percent
          });
        }
      }
    });

    child.stderr!.on("data", () => {});
    child.on("exit", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code}`));
    });

    child.on("error", reject);
  });
}

async function ensureOutputDir(rootDir: string, filePath: string): Promise<void> {
  await ensureDir(path.dirname(path.resolve(rootDir, filePath)));
}

export async function renderRouteToVideo(
  routeConfig: RouteConfig,
  options: RenderRouteToVideoOptions
): Promise<RenderResult> {
  const {
    rootDir,
    renderBaseUrl,
    providerRegistry,
    onProgress
  } = options;
  const tmpDir = path.join(rootDir, ".tmp");
  await ensureDir(tmpDir);

  onProgress?.({ stage: "preparing" });
  const route = await prepareRoute(
    routeConfig,
    providerRegistry ? { providerRegistry } : {}
  );
  route.output = buildOutputPath(routeConfig);

  let browser: Browser | undefined;
  const frameDir = path.join(tmpDir, route.id);

  try {
    browser = await chromium.launch();
    const page: Page = await browser.newPage({
      viewport: {
        width: Number(route.width ?? 1920),
        height: Number(route.height ?? 1080)
      },
      deviceScaleFactor: 1
    });

    page.on("pageerror", (error: Error) => {
      console.error("Page error:", error);
    });

    await page.goto(renderBaseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const rendererWindow = window as Window & RendererWindow;
      return Boolean(rendererWindow.__MAP_RENDERER_READY__);
    });

    onProgress?.({ stage: "priming_tiles" });
    await page.evaluate(async (scene: PreparedRoute) => {
      const rendererWindow = window as Window & RendererWindow;
      const renderer = rendererWindow.__MAP_RENDERER__;
      if (!renderer) {
        throw new Error("Renderer API is unavailable");
      }

      await renderer.setScene(scene);
      await renderer.primeTiles();
    }, route);

    const fps = Number(route.fps ?? 30);
    const durationSeconds = Number(route.durationSeconds ?? 8);
    const totalFrames = Math.max(2, Math.round(fps * durationSeconds));

    await fs.rm(frameDir, { recursive: true, force: true });
    await ensureDir(frameDir);

    for (let frame = 0; frame < totalFrames; frame += 1) {
      const progress = totalFrames === 1 ? 1 : frame / (totalFrames - 1);
      await page.evaluate(async (value: number) => {
        const rendererWindow = window as Window & RendererWindow;
        const renderer = rendererWindow.__MAP_RENDERER__;
        if (!renderer) {
          throw new Error("Renderer API is unavailable");
        }

        await renderer.renderFrame(value);
      }, progress);
      await page.screenshot({
        path: path.join(frameDir, `frame-${String(frame).padStart(5, "0")}.png`)
      });
      onProgress?.({
        stage: "capturing_frames",
        frame: frame + 1,
        totalFrames,
        percent: ((frame + 1) / totalFrames) * 100
      });
    }

    onProgress?.({ stage: "encoding_video", percent: 0 });
    const output = buildOutputPath(route);
    route.output = output;
    await ensureOutputDir(rootDir, output);
    const outputPath = path.resolve(rootDir, output);
    const args = [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      path.join(frameDir, "frame-%05d.png"),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      outputPath
    ];
    await runFfmpegWithProgress(args, {
      cwd: rootDir,
      durationSeconds,
      ...(onProgress ? { onProgress } : {})
    });

    onProgress?.({
      stage: "completed",
      percent: 100
    });

    return {
      outputPath,
      route
    };
  } finally {
    if (browser) {
      await browser.close();
    }

    await sleep(150);
  }
}
