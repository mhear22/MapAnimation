<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";

const props = defineProps({
  route: {
    type: Object,
    default: null
  },
  progress: {
    type: Number,
    required: true
  }
});

const iframeRef = ref(null);
const ready = ref(false);
const pending = new Map();

function createRequestId() {
  return `req-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function onMessage(event) {
  const payload = event.data;
  if (!payload || payload.namespace !== "mapanim") {
    return;
  }

  if (payload.type === "ready") {
    ready.value = true;
    return;
  }

  const entry = pending.get(payload.requestId);
  if (!entry) {
    return;
  }

  pending.delete(payload.requestId);

  if (payload.type === "command-error") {
    entry.reject(new Error(payload.message));
    return;
  }

  entry.resolve();
}

function sendCommand(type, extra = {}) {
  if (!iframeRef.value?.contentWindow) {
    return Promise.resolve();
  }

  const requestId = createRequestId();
  const payload = JSON.parse(
    JSON.stringify({
      namespace: "mapanim",
      requestId,
      type,
      ...toRaw(extra)
    })
  );
  const promise = new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
  });

  iframeRef.value.contentWindow.postMessage(payload, window.location.origin);

  return promise;
}

async function syncScene(scene) {
  await nextTick();

  if (!ready.value || !scene) {
    return;
  }

  await sendCommand("set-scene", { scene });
  await sendCommand("render-frame", { progress: props.progress });
}

watch(
  ready,
  async (value) => {
    if (!value || !props.route) {
      return;
    }

    try {
      await syncScene(props.route);
    } catch (error) {
      console.error(error);
    }
  }
);

watch(
  () => props.route,
  async (scene) => {
    if (!scene) {
      return;
    }

    try {
      await syncScene(scene);
    } catch (error) {
      console.error(error);
    }
  },
  { deep: true }
);

watch(
  () => props.progress,
  async (value) => {
    if (!ready.value || !props.route) {
      return;
    }

    try {
      await sendCommand("render-frame", { progress: value });
    } catch (error) {
      console.error(error);
    }
  }
);

onMounted(() => {
  window.addEventListener("message", onMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
});
</script>

<template>
  <div class="preview-shell">
    <div class="preview-frame">
      <iframe
        ref="iframeRef"
        title="Map animation preview"
        src="/render/"
      />
      <div v-if="!route" class="preview-empty">
        Search two locations to load a preview.
      </div>
    </div>
  </div>
</template>
