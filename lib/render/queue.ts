import { EventEmitter } from "node:events";
import type { RenderJob, RenderProgress, RenderResult } from "../../types/index.js";
import type { RouteConfig } from "../../types/index.js";

type WorkerCallback = (
  payload: { route: RouteConfig },
  emitProgress: (progress: Partial<RenderProgress>) => void,
  signal: AbortSignal
) => Promise<RenderResult>;

type JobsListener = (jobs: RenderJob[]) => void;

interface RenderQueue {
  list(): RenderJob[];
  enqueue(payload: { route: RouteConfig }): RenderJob;
  cancel(jobId: string): boolean;
  subscribe(listener: JobsListener): () => void;
}

class CancelledError extends Error {
  constructor() {
    super("Render cancelled");
    this.name = "CancelledError";
  }
}

function isCancelledError(error: unknown): boolean {
  return error instanceof CancelledError || (error instanceof DOMException && error.name === "AbortError");
}

export function createRenderQueue({ worker }: { worker: WorkerCallback }): RenderQueue {
  const emitter = new EventEmitter();
  const jobs: RenderJob[] = [];
  const controllers = new Map<string, AbortController>();
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

    const controller = controllers.get(nextJob.id);

    try {
      const result = await worker(nextJob.payload, (progress) => {
        nextJob.stage = progress.stage ?? nextJob.stage;
        nextJob.progress = {
          ...nextJob.progress,
          ...progress
        };
        nextJob.updatedAt = new Date().toISOString();
        broadcast();
      }, controller?.signal ?? new AbortController().signal);
      nextJob.status = "completed";
      nextJob.stage = "completed";
      nextJob.result = result;
      nextJob.updatedAt = new Date().toISOString();
      broadcast();
    } catch (error) {
      if (isCancelledError(error)) {
        nextJob.status = "cancelled";
        nextJob.stage = "cancelled";
      } else {
        nextJob.status = "failed";
        nextJob.stage = "failed";
        nextJob.error = (error as Error).message;
      }
      nextJob.updatedAt = new Date().toISOString();
      broadcast();
    } finally {
      controllers.delete(nextJob.id);
      running = false;
      await pump();
    }
  }

  return {
    list(): RenderJob[] {
      return jobs.map((job) => ({ ...job }));
    },

    enqueue(payload: { route: RouteConfig }): RenderJob {
      const controller = new AbortController();
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
      controllers.set(job.id, controller);
      jobs.unshift(job);
      broadcast();
      void pump();
      return { ...job };
    },

    cancel(jobId: string): boolean {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        return false;
      }

      if (job.status !== "queued" && job.status !== "running") {
        return false;
      }

      job.status = "cancelled";
      job.stage = "cancelled";
      job.updatedAt = new Date().toISOString();

      const controller = controllers.get(jobId);
      if (controller) {
        controller.abort();
      }

      broadcast();
      return true;
    },

    subscribe(listener: JobsListener): () => void {
      emitter.on("jobs", listener);
      return () => emitter.off("jobs", listener);
    }
  };
}
