import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRenderAssetHandler } from "./asset-handler.js";

interface AssetServer {
  baseUrl: string;
  close(): Promise<void>;
}

interface CreateRenderAssetServerOptions {
  rootDir: string;
  webDir: string;
}

export async function createRenderAssetServer({ rootDir, webDir }: CreateRenderAssetServerOptions): Promise<AssetServer> {
  const handleRenderAssetRequest = createRenderAssetHandler({
    rootDir,
    webDir,
    mountPath: "/"
  });

  const server = http.createServer(async (request: http.IncomingMessage, response: http.ServerResponse) => {
    const handled = await handleRenderAssetRequest(request, response);
    if (!handled) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Missing asset: ${new URL(request.url ?? "/", "http://127.0.0.1").pathname}`);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}
