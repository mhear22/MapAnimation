import { EventEmitter } from "node:events";

export function createRenderQueue({ worker }) {
  const emitter = new EventEmitter();
  const jobs = [];
  let running = false;

  function broadcast() {
    emitter.emit("jobs", jobs.map((job) => ({ ...job })));
  }

  async function pump() {
    if (running) {
      return;
    }

    const nextJob = jobs.find((job) => job.status === "queued");
    if (!nextJob) {
      return;
    }

    running = true;
    nextJob.status = "running";
    nextJob.stage = "preparing";
    nextJob.updatedAt = new Date().toISOString();
    broadcast();

    try {
      const result = await worker(nextJob.payload, (progress) => {
        nextJob.stage = progress.stage ?? nextJob.stage;
        nextJob.progress = {
          ...nextJob.progress,
          ...progress
        };
        nextJob.updatedAt = new Date().toISOString();
        broadcast();
      });
      nextJob.status = "completed";
      nextJob.stage = "completed";
      nextJob.result = result;
      nextJob.updatedAt = new Date().toISOString();
      broadcast();
    } catch (error) {
      nextJob.status = "failed";
      nextJob.stage = "failed";
      nextJob.error = error.message;
      nextJob.updatedAt = new Date().toISOString();
      broadcast();
    } finally {
      running = false;
      await pump();
    }
  }

  return {
    list() {
      return jobs.map((job) => ({ ...job }));
    },

    enqueue(payload) {
      const job = {
        id: `job-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        payload,
        status: "queued",
        stage: "queued",
        progress: {
          stage: "queued",
          percent: 0
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      jobs.unshift(job);
      broadcast();
      void pump();
      return { ...job };
    },

    subscribe(listener) {
      emitter.on("jobs", listener);
      return () => emitter.off("jobs", listener);
    }
  };
}
