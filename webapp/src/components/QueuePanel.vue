<script setup>
defineProps({
  jobs: {
    type: Array,
    required: true
  }
});

function describeProgress(job) {
  if (!job.progress) {
    return job.stage;
  }

  if (job.stage === "capturing_frames") {
    return `${job.progress.frame ?? 0}/${job.progress.totalFrames ?? 0} frames`;
  }

  if (typeof job.progress.percent === "number") {
    return `${Math.round(job.progress.percent)}%`;
  }

  return job.stage;
}

function routeLine(job) {
  const start = job.summary?.startLabel || "Unknown start";
  const end = job.summary?.endLabel || "Unknown end";
  return `${start} to ${end}`;
}
</script>

<template>
  <section class="queue-panel">
    <div class="section-header">
      <h2>Render queue</h2>
    </div>
    <div class="queue-list">
      <div v-if="!jobs.length" class="queue-empty">No jobs queued.</div>
      <article
        v-for="job in jobs"
        :key="job.id"
        class="queue-item"
        :data-status="job.status"
      >
        <div class="queue-row">
          <strong>{{ job.summary?.name || routeLine(job) }}</strong>
          <span class="queue-status">{{ job.status }}</span>
        </div>
        <div class="queue-meta">
          <span>{{ routeLine(job) }}</span>
          <span>{{ job.summary?.mode || "walking" }} / {{ job.summary?.mapType || "satellite" }}</span>
        </div>
        <div class="queue-meta">
          <span>{{ job.stage }}</span>
          <span>{{ describeProgress(job) }}</span>
        </div>
        <div v-if="typeof job.progress?.percent === 'number'" class="queue-bar">
          <div :style="{ width: `${Math.max(4, job.progress.percent)}%` }" />
        </div>
        <div v-if="job.error" class="queue-error">{{ job.error }}</div>
        <a
          v-if="job.result?.outputUrl"
          class="queue-link"
          :href="job.result.outputUrl"
          target="_blank"
          rel="noreferrer"
        >
          Open MP4
        </a>
      </article>
    </div>
  </section>
</template>
