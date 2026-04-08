import { EventEmitter } from "node:events";
import type { RenderJob, RenderProgress, RenderResult } from "../../types/index.js";
import type { RouteConfig } from "../../types/index.js";

type WorkerCallback = (
  payload: { route: RouteConfig },
  emitProgress: (progress: Partial<RenderProgress>) => void
) => Promise<RenderResult>;

type JobsListener = (jobs: RenderJob[]) => void;

interface RenderQueue {
  list(): RenderJob[];
  enqueue(payload: { route: RouteConfig }): RenderJob;
  subscribe(listener: JobsListener): () => void;
}

export function createRenderQueue({ worker }: { worker: WorkerCallback }): RenderQueue {
  const emitter = new EventEmitter();
  const jobs: RenderJob[] = [];
  let running = false;

  function broadcast(): void {
    emitter.emit("jobs", jobs.map((job) => ({ ...job })));
  }

  async function pump(): Promise<void> {
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
      nextJob.error = (error as Error).message;
      nextJob.updatedAt = new Date().toISOString();
      broadcast();
    } finally {
      running = false;
      await pump();
    }
  }

  return {
    list(): RenderJob[] {
      return jobs.map((job) => ({ ...job }));
    },

    enqueue(payload: { route: RouteConfig }): RenderJob {
      const job: RenderJob = {
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

    subscribe(listener: JobsListener): () => void {
      emitter.on("jobs", listener);
      return () => emitter.off("jobs", listener);
    }
  };
}
