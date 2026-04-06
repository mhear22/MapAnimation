import test from "node:test";
import assert from "node:assert/strict";
import { createRenderQueue } from "../lib/render/queue.js";

test("render queue processes jobs sequentially", async () => {
  const order = [];
  const queue = createRenderQueue({
    worker: async (payload, emit) => {
      order.push(`start:${payload.id}`);
      emit({ stage: "capturing_frames", frame: 1, totalFrames: 2, percent: 50 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end:${payload.id}`);
      return { outputPath: `/tmp/${payload.id}.mp4`, route: { id: payload.id } };
    }
  });

  queue.enqueue({ id: "one" });
  queue.enqueue({ id: "two" });

  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(order, ["start:one", "end:one", "start:two", "end:two"]);
  const jobs = queue.list();
  assert.equal(jobs[0].status, "completed");
  assert.equal(jobs[1].status, "completed");
});
