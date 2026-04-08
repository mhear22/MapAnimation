import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFlightPath, loadRoutes, normalizeCamera, prepareRoute } from "../lib/routes.js";
import type { NormalizedCamera, PreparedRoute, ProviderRegistry, RouteConfig } from "../types/index.js";

test("normalizeCamera applies defaults and clamps values", () => {
  const camera: NormalizedCamera = normalizeCamera(
    {
      startZoom: 12.4,
      maxAltitude: 220,
      aggressiveness: -4,
      smoothing: -1
    },
    {}
  );

  assert.equal(camera.startZoom, 12.4);
  assert.equal(camera.endZoom, 12.4);
  assert.equal(camera.maxAltitude, 150);
  assert.equal(camera.aggressiveness, 0);
  assert.equal(camera.smoothing, 0);
});

test("normalizeCamera maps legacy fields to the new camera model", () => {
  const camera: NormalizedCamera = normalizeCamera(
    {
      peakAltitude: 72,
      curvePosition: 61
    },
    {}
  );

  assert.equal(camera.maxAltitude, 122);
  assert.equal(camera.aggressiveness, 61);
});

test("buildFlightPath keeps endpoints intact", () => {
  const from: [number, number] = [144.84, -37.67];
  const to: [number, number] = [151.17, -33.94];
  const flightPath = buildFlightPath(from, to);

  assert.deepEqual(flightPath.coordinates[0], from);
  assert.deepEqual(flightPath.coordinates[flightPath.coordinates.length - 1], to);
  assert.equal(flightPath.profile, "flight");
  assert.ok(flightPath.coordinates.length >= 48);
});

test("prepareRoute resolves coords and routes via injected provider", async () => {
  const providerRegistry: ProviderRegistry = {
    defaultProvider: "mock",
    getProvider() {
      return {
        id: "mock",
        async search() {
          return [];
        },
        async geocode(query: string) {
          return {
            id: query,
            provider: "mock",
            label: query,
            query,
            coords: query.includes("Origin") ? [1, 2] as [number, number] : [3, 4] as [number, number]
          };
        },
        async route() {
          return {
            coordinates: [
              [1, 2],
              [2, 3],
              [3, 4]
            ] as [number, number][],
            distanceMeters: 1500,
            durationSeconds: 420,
            profile: "driving"
          };
        }
      };
    },
    listProviders() {
      return ["mock"];
    }
  };

  const route: PreparedRoute = await prepareRoute(
    {
      mode: "driving",
      start: { label: "Origin", query: "Origin" },
      end: { label: "Destination", query: "Destination" }
    },
    { providerRegistry }
  );

  assert.deepEqual(route.from.coords, [1, 2]);
  assert.deepEqual(route.to.coords, [3, 4]);
  assert.equal(route.path.profile, "driving");
  assert.equal(route.camera.aggressiveness, 50);
  assert.equal(route.camera.maxAltitude, 100);
});

test("prepareRoute backfills geocoded labels when the UI only sends queries", async () => {
  const providerRegistry: ProviderRegistry = {
    defaultProvider: "mock",
    getProvider() {
      return {
        id: "mock",
        async search() {
          return [];
        },
        async geocode(query: string) {
          return {
            id: query,
            provider: "mock",
            label: `${query} label`,
            query: `${query} canonical`,
            coords: query.includes("Origin") ? [1, 2] as [number, number] : [3, 4] as [number, number]
          };
        },
        async route() {
          return {
            coordinates: [
              [1, 2],
              [2, 3],
              [3, 4]
            ] as [number, number][],
            distanceMeters: 1500,
            durationSeconds: 420,
            profile: "foot"
          };
        }
      };
    },
    listProviders() {
      return ["mock"];
    }
  };

  const route: PreparedRoute = await prepareRoute(
    {
      mode: "walking",
      start: { query: "Origin" },
      end: { query: "Destination" }
    },
    { providerRegistry }
  );

  assert.equal(route.from.label, "Origin label");
  assert.equal(route.to.label, "Destination label");
  assert.equal(route.from.query, "Origin");
  assert.equal(route.to.query, "Destination");
});

test("loadRoutes filters config routes by --id", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mapanim-routes-"));

  try {
    await fs.writeFile(
      path.join(rootDir, "routes.json"),
      JSON.stringify({
        defaults: { durationSeconds: 8 },
        routes: [
          { id: "first", start: { query: "A" }, end: { query: "B" } },
          { id: "second", start: { query: "C" }, end: { query: "D" } }
        ]
      }),
      "utf8"
    );

    const routes: RouteConfig[] = await loadRoutes({ config: "./routes.json", id: "second" }, { rootDir });

    assert.equal(routes.length, 1);
    assert.equal(routes[0].id, "second");
    assert.equal(routes[0].durationSeconds, 8);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
