import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { buildOutputPath, prepareRoute } from "../routes.js";
import { ensureDir, sleep } from "../utils.js";
import type { RouteConfig, PreparedRoute, RenderProgress, RenderResult } from "../../types/index.js";
import type { ProviderRegistry, RendererWindow } from "../../types/index.js";

interface RenderRouteToVideoOptions {
  rootDir: string;
  renderBaseUrl: string;
  providerRegistry?: ProviderRegistry;
  onProgress?: (progress: Partial<RenderProgress>) => void;
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

  onProgress?.({ stage: "preparing" });
  const route = await prepareRoute(
    routeConfig,
    providerRegistry ? { providerRegistry } : {}
  );
  route.output = buildOutputPath(routeConfig);

  let browser: Browser | undefined;

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

    const output = buildOutputPath(route);
    route.output = output;
    await ensureOutputDir(rootDir, output);
    const outputPath = path.resolve(rootDir, output);

    const ffmpegArgs = [
      "-y",
      "-f", "image2pipe",
      "-framerate", String(fps),
      "-i", "pipe:0",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath
    ];

    const ffmpegProcess: ChildProcess = spawn("ffmpeg", ffmpegArgs, { cwd: rootDir });
    const ffmpegStdin = ffmpegProcess.stdin!;
    ffmpegStdin.on("error", () => {});
    ffmpegProcess.stdout!.on("data", () => {});
    ffmpegProcess.stderr!.on("data", () => {});

    let ffmpegExitCode: number | null = null;
    let ffmpegExited = false;

    ffmpegProcess.on("exit", (code: number | null) => {
      ffmpegExitCode = code;
      ffmpegExited = true;
    });

    onProgress?.({ stage: "capturing_frames", percent: 0 });

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

      const buffer = await page.screenshot({ type: "jpeg", quality: 92 });

      if (ffmpegExited) {
        throw new Error(`ffmpeg exited prematurely with code ${ffmpegExitCode}`);
      }

      const drained = ffmpegStdin.write(buffer);
      if (!drained) {
        await new Promise<void>((resolve) => {
          const onDrain = () => { cleanup(); resolve(); };
          const onExit = () => { cleanup(); resolve(); };
          const cleanup = () => {
            ffmpegStdin.removeListener("drain", onDrain);
            ffmpegProcess.removeListener("exit", onExit);
          };
          ffmpegStdin.once("drain", onDrain);
          ffmpegProcess.once("exit", onExit);
        });
      }

      onProgress?.({
        stage: "capturing_frames",
        frame: frame + 1,
        totalFrames,
        percent: ((frame + 1) / totalFrames) * 100
      });
    }

    onProgress?.({ stage: "encoding_video", percent: 0 });
    ffmpegStdin.end();

    await new Promise<void>((resolve, reject) => {
      if (ffmpegExited) {
        if (ffmpegExitCode === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${ffmpegExitCode}`));
        }
        return;
      }

      ffmpegProcess.on("exit", (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      ffmpegProcess.on("error", reject);
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
