import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPresetStore } from "../lib/presets/store.js";
import { createProviderRegistry } from "../lib/providers/index.js";
import { createRenderQueue } from "../lib/render/queue.js";
import { createRenderAssetHandler, safeResolve } from "../lib/render/asset-handler.js";
import { renderRouteToVideo } from "../lib/render/video.js";
import { prepareRoute } from "../lib/routes.js";
import { createTileCache } from "../lib/tile-cache.js";
import { contentTypeFor } from "../lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webDir = path.join(rootDir, "web");
const webappDistDir = path.join(rootDir, "webapp", "dist");
const isDev = process.env.MAPANIM_DEV === "1";
const providerRegistry = createProviderRegistry();
const presetStore = createPresetStore({ rootDir });
const tileCache = createTileCache();
const sseClients = new Set();
let baseUrl = null;

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
  }

  return body ? JSON.parse(body) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function jobSummary(route = {}) {
  return {
    id: route.id ?? null,
    name: route.name ?? route.id ?? null,
    startLabel: route.start?.label ?? route.from?.label ?? route.start?.query ?? "",
    endLabel: route.end?.label ?? route.to?.label ?? route.end?.query ?? "",
    mode: route.mode ?? "walking",
    mapType: route.mapType ?? "satellite",
    output: route.output ?? null
  };
}

function outputUrlFromAbsolute(filePath) {
  if (!filePath) {
    return null;
  }

  const relative = path.relative(rootDir, filePath);
  if (relative.startsWith("..")) {
    return null;
  }

  return `/${relative.split(path.sep).join("/")}`;
}

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    error: job.error ?? null,
    progress: job.progress ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    summary: jobSummary(job.payload?.route),
    result: job.result
      ? {
          outputPath: job.result.outputPath,
          outputUrl: outputUrlFromAbsolute(job.result.outputPath),
          routeId: job.result.route?.id ?? null
        }
      : null
  };
}

function broadcastJobs(queue) {
  const payload = `data: ${JSON.stringify({ jobs: queue.list().map(serializeJob) })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

const queue = createRenderQueue({
  worker: async (payload, emitProgress) =>
    renderRouteToVideo(payload.route, {
      rootDir,
      renderBaseUrl: `${baseUrl}/render/`,
      providerRegistry,
      onProgress: emitProgress
    })
});

queue.subscribe(() => {
  broadcastJobs(queue);
});

const handleRenderAssetRequest = createRenderAssetHandler({
  rootDir,
  webDir,
  mountPath: "/render",
  allowOutput: true,
  tileCache
});

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/search") {
    const requested = new URL(request.url, baseUrl ?? "http://127.0.0.1");
    const query = requested.searchParams.get("q")?.trim();
    const providerName = requested.searchParams.get("provider") ?? providerRegistry.defaultProvider;

    if (!query) {
      sendJson(response, 200, { results: [] });
      return true;
    }

    const provider = providerRegistry.getProvider(providerName);
    const results = await provider.search(query, { limit: 5 });
    sendJson(response, 200, { results });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/preview") {
    const body = await readRequestBody(request);
    const route = await prepareRoute(body.route ?? body, { providerRegistry });
    sendJson(response, 200, { route });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/presets") {
    const presets = await presetStore.list();
    sendJson(response, 200, { presets });
    return true;
  }

  if (request.method === "GET" && pathname.startsWith("/api/presets/")) {
    const id = decodeURIComponent(pathname.replace("/api/presets/", ""));
    const preset = await presetStore.get(id);
    sendJson(response, 200, preset);
    return true;
  }

  if (request.method === "POST" && pathname === "/api/presets") {
    const body = await readRequestBody(request);
    const saved = await presetStore.save({
      name: body.name,
      route: body.route
    });
    sendJson(response, 200, saved);
    return true;
  }

  if (request.method === "GET" && pathname === "/api/render-jobs") {
    sendJson(response, 200, { jobs: queue.list().map(serializeJob) });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/render-jobs") {
    const body = await readRequestBody(request);
    const job = queue.enqueue({
      route: body.route ?? body
    });
    sendJson(response, 202, { job: serializeJob(job) });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/render-events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    response.write(`data: ${JSON.stringify({ jobs: queue.list().map(serializeJob) })}\n\n`);
    sseClients.add(response);
    request.on("close", () => {
      sseClients.delete(response);
    });
    return true;
  }

  return false;
}

async function serveFile(response, filePath) {
  const data = await fs.readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypeFor(filePath)
  });
  response.end(data);
}

function sendError(response, error) {
  response.writeHead(500, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify({ error: error.message }));
}

async function createViteDevServer(server) {
  const { createServer } = await import("vite");
  process.env.MAPANIM_VITE_MIDDLEWARE = "1";

  return createServer({
    configFile: path.join(rootDir, "vite.config.js"),
    server: {
      middlewareMode: true,
      hmr: {
        server
      }
    }
  });
}

async function handOffToVite(vite, request, response) {
  if (!vite) {
    return false;
  }

  await new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      response.off("finish", onFinish);
      response.off("close", onClose);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const onFinish = () => finish();
    const onClose = () => finish();

    response.on("finish", onFinish);
    response.on("close", onClose);

    vite.middlewares(request, response, (error) => finish(error));
  });

  return response.writableEnded;
}

async function handleRequest(request, response, vite) {
  try {
    const requested = new URL(request.url, baseUrl ?? "http://127.0.0.1");
    const pathname = requested.pathname;

    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, pathname);
      if (!handled) {
        sendJson(response, 404, { error: "Not found" });
      }
      return;
    }

    if (await handleRenderAssetRequest(request, response, pathname)) {
      return;
    }

    if (await handOffToVite(vite, request, response)) {
      return;
    }

    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const assetPath = safeResolve(webappDistDir, requestedPath);

    try {
      await serveFile(response, assetPath);
      return;
    } catch {}

    await serveFile(response, path.join(webappDistDir, "index.html"));
  } catch (error) {
    vite?.ssrFixStacktrace?.(error);
    if (!response.headersSent) {
      sendError(response, error);
      return;
    }

    response.end();
  }
}

async function main() {
  let vite = null;
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, vite);
  });

  if (isDev) {
    vite = await createViteDevServer(server);
  }

  const port = Number(process.env.PORT ?? 5173);
  const host = process.env.HOST ?? "127.0.0.1";
  const localBaseHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  server.listen(port, host, () => {
    const address = server.address();
    const resolvedPort = typeof address === "object" && address ? address.port : port;
    baseUrl = `http://${localBaseHost}:${resolvedPort}`;

    if (host === localBaseHost) {
      console.log(`MapAnim webapp running at ${baseUrl}`);
      return;
    }

    console.log(`MapAnim webapp running at ${baseUrl} (listening on ${host}:${resolvedPort})`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
