import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { contentTypeFor } from "../utils.js";

export async function createRenderAssetServer({ rootDir, webDir }) {
  const server = http.createServer(async (request, response) => {
    const requested = new URL(request.url, "http://127.0.0.1");
    let filePath = requested.pathname === "/" ? path.join(webDir, "index.html") : path.join(rootDir, requested.pathname);

    if (requested.pathname === "/renderer.js") {
      filePath = path.join(webDir, "renderer.js");
    }

    try {
      const data = await fs.readFile(filePath);
      response.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      response.end(data);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Missing asset: ${requested.pathname}`);
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
