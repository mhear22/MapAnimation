import test from "node:test";
import assert from "node:assert/strict";
import { createRenderQueue } from "../lib/render/queue.js";
import type { RenderResult } from "../types/index.js";

test("render queue processes jobs sequentially", async () => {
  const order: string[] = [];
  const queue = createRenderQueue({
    worker: async (payload, emit) => {
      order.push(`start:${payload.route.id}`);
      emit({ stage: "capturing_frames", frame: 1, totalFrames: 2, percent: 50 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end:${payload.route.id}`);
      const result: RenderResult = {
        outputPath: `/tmp/${payload.route.id}.mp4`,
        route: { id: payload.route.id } as RenderResult["route"]
      };
      return result;
    }
  });

  queue.enqueue({ route: { id: "one" } });
  queue.enqueue({ route: { id: "two" } });

  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(order, ["start:one", "end:one", "start:two", "end:two"]);
  const jobs = queue.list();
  const [firstJob, secondJob] = jobs;
  assert.ok(firstJob);
  assert.ok(secondJob);
  assert.equal(firstJob.status, "completed");
  assert.equal(secondJob.status, "completed");
});
