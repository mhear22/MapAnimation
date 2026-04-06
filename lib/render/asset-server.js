import http from "node:http";
import { createRenderAssetHandler } from "./asset-handler.js";

export async function createRenderAssetServer({ rootDir, webDir }) {
  const handleRenderAssetRequest = createRenderAssetHandler({
    rootDir,
    webDir,
    mountPath: "/"
  });

  const server = http.createServer(async (request, response) => {
    const handled = await handleRenderAssetRequest(request, response);
    if (!handled) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Missing asset: ${new URL(request.url, "http://127.0.0.1").pathname}`);
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}
