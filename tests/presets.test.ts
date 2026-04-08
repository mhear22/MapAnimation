import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPresetStore } from "../lib/presets/store.js";
import type { PresetDetail, PresetItem } from "../types/index.js";

test("preset store saves, lists, and reloads presets", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mapanim-presets-"));
  await fs.writeFile(path.join(rootDir, "routes.json"), JSON.stringify({ routes: [] }), "utf8");
  const store = createPresetStore({ rootDir });

  const saved: PresetDetail = await store.save({
    name: "Airport Hop",
    route: {
      id: "airport-hop",
      start: { label: "A", query: "A" },
      end: { label: "B", query: "B" },
      camera: { peakAltitude: 72 }
    }
  });

  assert.equal(saved.id, "preset:airport-hop");

  const listed: PresetItem[] = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "Airport Hop");

  const loaded: PresetDetail = await store.get("preset:airport-hop");
  assert.equal(loaded.route.camera!.peakAltitude, 72);
});
