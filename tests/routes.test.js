import test from "node:test";
import assert from "node:assert/strict";
import { buildFlightPath, normalizeCamera, prepareRoute } from "../lib/routes.js";

test("normalizeCamera applies defaults and clamps values", () => {
  const camera = normalizeCamera(
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
  const camera = normalizeCamera(
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
  const from = [144.84, -37.67];
  const to = [151.17, -33.94];
  const path = buildFlightPath(from, to);

  assert.deepEqual(path.coordinates[0], from);
  assert.deepEqual(path.coordinates[path.coordinates.length - 1], to);
  assert.equal(path.profile, "flight");
  assert.ok(path.coordinates.length >= 48);
});

test("prepareRoute resolves coords and routes via injected provider", async () => {
  const providerRegistry = {
    defaultProvider: "mock",
    getProvider() {
      return {
        async geocode(query) {
          return {
            label: query,
            query,
            coords: query.includes("Origin") ? [1, 2] : [3, 4]
          };
        },
        async route() {
          return {
            coordinates: [
              [1, 2],
              [2, 3],
              [3, 4]
            ],
            distanceMeters: 1500,
            durationSeconds: 420,
            profile: "driving"
          };
        }
      };
    }
  };

  const route = await prepareRoute(
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
  const providerRegistry = {
    defaultProvider: "mock",
    getProvider() {
      return {
        async geocode(query) {
          return {
            label: `${query} label`,
            query: `${query} canonical`,
            coords: query.includes("Origin") ? [1, 2] : [3, 4]
          };
        },
        async route() {
          return {
            coordinates: [
              [1, 2],
              [2, 3],
              [3, 4]
            ],
            distanceMeters: 1500,
            durationSeconds: 420,
            profile: "foot"
          };
        }
      };
    }
  };

  const route = await prepareRoute(
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
