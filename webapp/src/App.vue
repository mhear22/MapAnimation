<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import CurveEditor from "./components/CurveEditor.vue";
import QueuePanel from "./components/QueuePanel.vue";
import RenderPreview from "./components/RenderPreview.vue";
import SearchField from "./components/SearchField.vue";

function createDefaultRoute() {
  return {
    id: "",
    name: "",
    provider: "osm",
    mode: "walking",
    mapType: "satellite",
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 8,
    overviewPadding: 180,
    output: "",
    start: {
      label: "",
      query: "",
      coords: null
    },
    end: {
      label: "",
      query: "",
      coords: null
    },
    path: null,
    camera: {
      startZoom: 15.8,
      endZoom: 15.8,
      maxAltitude: 100,
      aggressiveness: 50,
      smoothing: 0.92
    }
  };
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }

  return response.json();
}

function routeForPreview(route) {
  return {
    ...route,
    start: {
      ...route.start,
      coords: route.start.coords ?? undefined
    },
    end: {
      ...route.end,
      coords: route.end.coords ?? undefined
    }
  };
}

function distanceLabel(route) {
  const meters = route?.path?.distanceMeters;
  if (!meters) {
    return "Distance unavailable";
  }

  return meters > 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

const route = reactive(createDefaultRoute());
const previewRoute = ref(null);
const previewProgress = ref(0);
const previewError = ref("");
const previewLoading = ref(false);
const presetName = ref("");
const presets = ref([]);
const jobs = ref([]);
const searchState = reactive({
  startResults: [],
  endResults: [],
  startLoading: false,
  endLoading: false
});

let events = null;
let startSearchTimer = 0;
let endSearchTimer = 0;
let previewTimer = 0;

const previewReady = computed(() => Boolean(route.start.query.trim() && route.end.query.trim()));
const transitNeedsPresetPath = computed(() => {
  if (route.mode !== "public transport") {
    return false;
  }

  return !Array.isArray(route.path?.coordinates) || route.path.coordinates.length < 2;
});
const canQueueRender = computed(() => previewReady.value && !transitNeedsPresetPath.value);
const routeSummaryLabel = computed(() => route.name || route.id || "Untitled route");
const previewLocationLabel = computed(() => {
  if (!previewRoute.value) {
    return "No preview loaded";
  }

  const startLabel =
    previewRoute.value.from?.label ||
    previewRoute.value.start?.label ||
    previewRoute.value.from?.query ||
    previewRoute.value.start?.query ||
    route.start.label ||
    route.start.query ||
    "Origin";
  const endLabel =
    previewRoute.value.to?.label ||
    previewRoute.value.end?.label ||
    previewRoute.value.to?.query ||
    previewRoute.value.end?.query ||
    route.end.label ||
    route.end.query ||
    "Destination";

  return `${startLabel} to ${endLabel}`;
});
const previewStatus = computed(() => {
  if (!previewReady.value) {
    return "Enter both locations to load a preview";
  }

  if (transitNeedsPresetPath.value) {
    return "Public transport needs a preset with path coordinates";
  }

  if (previewError.value) {
    return previewError.value;
  }

  if (previewLoading.value) {
    return "Refreshing preview";
  }

  return previewRoute.value ? "Preview synced" : "Preview unavailable";
});

async function loadPresets() {
  const payload = await requestJson("/api/presets");
  presets.value = payload.presets;
}

async function loadJobs() {
  const payload = await requestJson("/api/render-jobs");
  jobs.value = payload.jobs;
}

function applyRoute(nextRoute) {
  const defaults = createDefaultRoute();
  const nextCamera = nextRoute.camera ?? {};

  Object.assign(route, defaults, nextRoute, {
    start: {
      ...defaults.start,
      ...(nextRoute.start ?? nextRoute.from ?? {})
    },
    end: {
      ...defaults.end,
      ...(nextRoute.end ?? nextRoute.to ?? {})
    },
    path: nextRoute.path ?? defaults.path,
    camera: {
      ...defaults.camera,
      ...nextCamera,
      maxAltitude:
        nextCamera.maxAltitude ??
        (nextCamera.peakAltitude != null
          ? 50 + Number(nextCamera.peakAltitude)
          : defaults.camera.maxAltitude),
      aggressiveness:
        nextCamera.aggressiveness ?? nextCamera.curvePosition ?? defaults.camera.aggressiveness
    }
  });
}

async function savePreset() {
  const payload = await requestJson("/api/presets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: presetName.value || route.name || "Route preset",
      route: JSON.parse(JSON.stringify(route))
    })
  });

  presetName.value = payload.name;
  route.id = payload.route.id;
  route.name = payload.route.name ?? route.name;
  await loadPresets();
}

async function loadPreset(id) {
  const payload = await requestJson(`/api/presets/${encodeURIComponent(id)}`);
  applyRoute(payload.route);
  presetName.value = payload.name ?? payload.route.name ?? "";
  previewProgress.value = 0;
  schedulePreview(0);
}

async function queueRender() {
  if (!canQueueRender.value) {
    return;
  }

  await requestJson("/api/render-jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      route: JSON.parse(JSON.stringify(route))
    })
  });
}

function resetRoute() {
  applyRoute(createDefaultRoute());
  presetName.value = "";
  previewProgress.value = 0;
  previewRoute.value = null;
  previewError.value = "";
  searchState.startResults = [];
  searchState.endResults = [];
  searchState.startLoading = false;
  searchState.endLoading = false;
}

function applySearchResult(kind, result) {
  route[kind] = {
    label: result.label,
    query: result.query,
    coords: result.coords
  };
  searchState[`${kind}Results`] = [];
  schedulePreview(0);
}

function updateLocationQuery(kind, query) {
  route[kind] = {
    ...route[kind],
    label: "",
    query,
    coords: null
  };
  if (!query.trim()) {
    searchState[`${kind}Results`] = [];
  }
  schedulePreview(0);
}

function scheduleSearch(kind, query) {
  const timerName = kind === "start" ? "startSearchTimer" : "endSearchTimer";
  window.clearTimeout(timerName === "startSearchTimer" ? startSearchTimer : endSearchTimer);

  const handle = window.setTimeout(async () => {
    const resultsKey = `${kind}Results`;
    const loadingKey = `${kind}Loading`;

    if (!query || query.trim().length < 3) {
      searchState[resultsKey] = [];
      searchState[loadingKey] = false;
      return;
    }

    searchState[loadingKey] = true;

    try {
      const payload = await requestJson(`/api/search?q=${encodeURIComponent(query)}`);
      searchState[resultsKey] = payload.results;
    } catch (error) {
      console.error(error);
    } finally {
      searchState[loadingKey] = false;
    }
  }, 260);

  if (timerName === "startSearchTimer") {
    startSearchTimer = handle;
  } else {
    endSearchTimer = handle;
  }
}

function schedulePreview(delayMs = 320) {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    if (!previewReady.value) {
      previewRoute.value = null;
      previewError.value = "";
      previewLoading.value = false;
      return;
    }

    if (transitNeedsPresetPath.value) {
      previewRoute.value = null;
      previewError.value = "";
      previewLoading.value = false;
      return;
    }

    const payload = routeForPreview(JSON.parse(JSON.stringify(route)));
    previewLoading.value = true;
    previewError.value = "";

    try {
      const preview = await requestJson("/api/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ route: payload })
      });
      previewRoute.value = preview.route;
    } catch (error) {
      previewRoute.value = null;
      previewError.value = error.message;
    } finally {
      previewLoading.value = false;
    }
  }, delayMs);
}

watch(
  () => route.start.query,
  (query) => {
    scheduleSearch("start", query);
  }
);

watch(
  () => route.end.query,
  (query) => {
    scheduleSearch("end", query);
  }
);

watch(
  route,
  () => {
    schedulePreview();
  },
  { deep: true, immediate: true }
);

onMounted(async () => {
  await Promise.all([loadPresets(), loadJobs()]);

  events = new EventSource("/api/render-events");
  events.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    jobs.value = payload.jobs;
  };
});

onBeforeUnmount(() => {
  window.clearTimeout(startSearchTimer);
  window.clearTimeout(endSearchTimer);
  window.clearTimeout(previewTimer);
  events?.close();
});
</script>

<template>
  <div class="app-shell">
    <aside class="control-column">
      <section class="panel">
        <div class="section-header">
          <h1>MapAnim</h1>
        </div>
        <div class="field-grid">
          <label class="field">
            <span class="field-label">Route name</span>
            <input v-model="route.name" class="text-input" placeholder="Airport hop" />
          </label>
          <label class="field">
            <span class="field-label">Preset name</span>
            <input v-model="presetName" class="text-input" placeholder="Reusable preset name" />
          </label>
          <label class="field">
            <span class="field-label">Output file</span>
            <input v-model="route.output" class="text-input" placeholder="output/custom.mp4" />
          </label>
        </div>
        <div class="button-row">
          <button
            type="button"
            class="button primary"
            :disabled="!canQueueRender"
            @click="queueRender"
          >
            Queue render
          </button>
          <button type="button" class="button" @click="savePreset">Save preset</button>
          <button type="button" class="button" @click="resetRoute">Start over</button>
        </div>
        <div class="field-note">Current route: {{ routeSummaryLabel }}</div>
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Locations</h2>
        </div>
        <SearchField
          :model-value="route.start.query"
          label="Origin"
          :results="searchState.startResults"
          :loading="searchState.startLoading"
          :selected-label="route.start.label"
          @update:model-value="updateLocationQuery('start', $event)"
          @select="applySearchResult('start', $event)"
        />
        <SearchField
          :model-value="route.end.query"
          label="Destination"
          :results="searchState.endResults"
          :loading="searchState.endLoading"
          :selected-label="route.end.label"
          @update:model-value="updateLocationQuery('end', $event)"
          @select="applySearchResult('end', $event)"
        />
        <div class="field-grid two-col">
          <label class="field">
            <span class="field-label">Travel mode</span>
            <select v-model="route.mode" class="select-input">
              <option value="walking">Walking</option>
              <option value="driving">Driving</option>
              <option value="flying">Flying</option>
              <option value="public transport">Public transport</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Map type</span>
            <select v-model="route.mapType" class="select-input">
              <option value="satellite">Satellite</option>
              <option value="standard">Standard</option>
            </select>
          </label>
        </div>
        <div v-if="transitNeedsPresetPath" class="field-note">
          Public transport is available for presets that already include route path coordinates.
        </div>
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Camera and motion</h2>
        </div>
        <CurveEditor
          :camera="route.camera"
          :progress="previewProgress"
          :route="previewRoute"
          @update-camera="route.camera = $event"
        />
        <div class="field-grid compact-grid">
          <label class="field">
            <span class="field-label">Duration</span>
            <input
              v-model.number="route.durationSeconds"
              class="text-input"
              type="number"
              min="4"
              max="20"
              step="0.5"
            />
          </label>
          <label class="field">
            <span class="field-label">Start zoom</span>
            <input
              v-model.number="route.camera.startZoom"
              class="text-input"
              type="number"
              min="3"
              max="18"
              step="0.1"
            />
          </label>
          <label class="field">
            <span class="field-label">End zoom</span>
            <input
              v-model.number="route.camera.endZoom"
              class="text-input"
              type="number"
              min="3"
              max="18"
              step="0.1"
            />
          </label>
          <label class="field">
            <span class="field-label">Max altitude</span>
            <input
              v-model.number="route.camera.maxAltitude"
              class="text-input"
              type="number"
              min="50"
              max="150"
              step="1"
            />
          </label>
          <label class="field">
            <span class="field-label">Lerp aggressiveness</span>
            <input
              v-model.number="route.camera.aggressiveness"
              class="text-input"
              type="number"
              min="0"
              max="100"
              step="1"
            />
          </label>
          <label class="field">
            <span class="field-label">Camera smoothing</span>
            <input
              v-model.number="route.camera.smoothing"
              class="text-input"
              type="number"
              min="0"
              max="1"
              step="0.01"
            />
          </label>
        </div>
      </section>

      <section class="panel preset-panel">
        <div class="section-header">
          <h2>Presets</h2>
        </div>
        <div class="preset-list">
          <button
            v-for="preset in presets"
            :key="preset.id"
            class="preset-item"
            type="button"
            @click="loadPreset(preset.id)"
          >
            <span>{{ preset.name }}</span>
            <span class="preset-source">{{ preset.source }}</span>
          </button>
        </div>
      </section>
    </aside>

    <main class="workspace">
      <section class="preview-panel">
        <div class="section-header">
          <h2>Preview</h2>
          <div class="preview-meta">
            <span>{{ previewRoute ? distanceLabel(previewRoute) : "No route" }}</span>
            <span>{{ previewStatus }}</span>
          </div>
        </div>
        <RenderPreview :route="previewRoute" :progress="previewProgress" />
        <div class="preview-caption">{{ previewLocationLabel }}</div>
        <label class="timeline">
          <span>Timeline</span>
          <input v-model.number="previewProgress" type="range" min="0" max="1" step="0.01" />
          <strong>{{ Math.round(previewProgress * 100) }}%</strong>
        </label>
      </section>

      <QueuePanel :jobs="jobs" />
    </main>
  </div>
</template>
