import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveRenderAssetPath, matchTileRequest } from "../lib/render/asset-handler.js";

const rootDir = "/tmp/mapanim";
const webDir = path.join(rootDir, "web");

test("resolveRenderAssetPath maps mounted render routes to web assets", () => {
  assert.equal(
    resolveRenderAssetPath("/render/", { rootDir, webDir, mountPath: "/render", allowOutput: true }),
    path.join(webDir, "index.html")
  );
  assert.equal(
    resolveRenderAssetPath("/render/renderer.js", { rootDir, webDir, mountPath: "/render", allowOutput: true }),
    path.join(webDir, "renderer.js")
  );
  assert.equal(
    resolveRenderAssetPath("/tile-cache-sw.js", { rootDir, webDir, mountPath: "/render", allowOutput: true }),
    path.join(webDir, "tile-cache-sw.js")
  );
});

test("resolveRenderAssetPath maps root-mounted render routes for the CLI asset server", () => {
  assert.equal(
    resolveRenderAssetPath("/", { rootDir, webDir, mountPath: "/" }),
    path.join(webDir, "index.html")
  );
  assert.equal(
    resolveRenderAssetPath("/renderer.js", { rootDir, webDir, mountPath: "/" }),
    path.join(webDir, "renderer.js")
  );
});

test("resolveRenderAssetPath limits static asset access to allowed prefixes", () => {
  assert.equal(
    resolveRenderAssetPath("/node_modules/maplibre-gl/dist/maplibre-gl.js", { rootDir, webDir, mountPath: "/render" }),
    path.join(rootDir, "node_modules/maplibre-gl/dist/maplibre-gl.js")
  );
  assert.equal(
    resolveRenderAssetPath("/output/demo.mp4", { rootDir, webDir, mountPath: "/render", allowOutput: true }),
    path.join(rootDir, "output/demo.mp4")
  );
  assert.equal(
    resolveRenderAssetPath("/output/demo.mp4", { rootDir, webDir, mountPath: "/render", allowOutput: false }),
    null
  );
});

test("resolveRenderAssetPath rejects path traversal", () => {
  assert.throws(
    () => resolveRenderAssetPath("/node_modules/../../secret.txt", { rootDir, webDir, mountPath: "/render" }),
    /Path escapes base directory/
  );
});

test("matchTileRequest parses tile endpoints", () => {
  assert.deepEqual(matchTileRequest("/tiles/satellite/10/15/22"), {
    provider: "satellite",
    z: 10,
    x: 15,
    y: 22
  });
  assert.equal(matchTileRequest("/render/"), null);
});
