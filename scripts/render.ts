import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderProgress } from "../types/index.js";
import type { RouteConfig } from "../types/index.js";
import { createProviderRegistry } from "../lib/providers/index.js";
import { createRenderAssetServer } from "../lib/render/asset-server.js";
import { renderRouteToVideo } from "../lib/render/video.js";
import { loadRoutes } from "../lib/routes.js";
import { parseArgs } from "../lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir: string = path.resolve(__dirname, "..");
const webDir: string = path.join(rootDir, "web");

async function main(): Promise<void> {
  const args: Record<string, string | boolean> = parseArgs(process.argv.slice(2));
  const routes: RouteConfig[] = await loadRoutes(args, { rootDir });
  const providerRegistry = createProviderRegistry();
  const assetServer = await createRenderAssetServer({ rootDir, webDir });

  try {
    for (const route of routes) {
      console.log(`Preparing ${route.id ?? route.output ?? "route"}`);
      const result = await renderRouteToVideo(route, {
        rootDir,
        renderBaseUrl: assetServer.baseUrl,
        providerRegistry,
        onProgress(progress: Partial<RenderProgress>): void {
          if (progress.stage === "capturing_frames") {
            console.log(
              `Capturing ${route.id ?? "route"} ${progress.frame}/${progress.totalFrames}`
            );
            return;
          }

          if (progress.stage === "encoding_video" && typeof progress.percent === "number") {
            console.log(`Encoding ${route.id ?? "route"} ${Math.round(progress.percent)}%`);
            return;
          }

          console.log(progress.stage);
        }
      });
      console.log(`Rendered ${route.id ?? "route"} -> ${result.outputPath}`);
    }
  } finally {
    await assetServer.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
