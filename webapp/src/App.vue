<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import CurveEditor from "./components/CurveEditor.vue";
import TimingCurveEditor from "./components/TimingCurveEditor.vue";
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
    start: { label: "", query: "", coords: null },
    end: { label: "", query: "", coords: null },
    path: null,
    camera: {
      startZoom: 15.8,
      endZoom: 15.8,
      maxAltitude: 100,
      aggressiveness: 50,
      smoothing: 0.92,
      timingCurve: 50,
      timingInverted: false
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
    start: { ...route.start, coords: route.start.coords ?? undefined },
    end: { ...route.end, coords: route.end.coords ?? undefined }
  };
}

function distanceLabel(route) {
  const meters = route?.path?.distanceMeters;
  if (!meters) return null;
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
const sidebarOpen = ref(false);
const queueOpen = ref(false);

const playing = ref(false);
let playRaf = 0;
let playStart = 0;
let playFrom = 0;

let events = null;
let startSearchTimer = 0;
let endSearchTimer = 0;
let previewTimer = 0;

const previewReady = computed(() => Boolean(route.start.query.trim() && route.end.query.trim()));
const transitNeedsPresetPath = computed(() => {
  if (route.mode !== "public transport") return false;
  return !Array.isArray(route.path?.coordinates) || route.path.coordinates.length < 2;
});
const canQueueRender = computed(() => previewReady.value && !transitNeedsPresetPath.value);
const routeSummaryLabel = computed(() => route.name || route.id || "Untitled route");
const previewLocationLabel = computed(() => {
  if (!previewRoute.value) return "";
  const startLabel =
    previewRoute.value.from?.label || previewRoute.value.start?.label ||
    previewRoute.value.from?.query || previewRoute.value.start?.query ||
    route.start.label || route.start.query || "Origin";
  const endLabel =
    previewRoute.value.to?.label || previewRoute.value.end?.label ||
    previewRoute.value.to?.query || previewRoute.value.end?.query ||
    route.end.label || route.end.query || "Destination";
  return `${startLabel} \u2192 ${endLabel}`;
});
const previewStatus = computed(() => {
  if (!previewReady.value) return { text: "Enter both locations to load a preview", type: "neutral" };
  if (transitNeedsPresetPath.value) return { text: "Public transport needs a preset with path coordinates", type: "neutral" };
  if (previewError.value) return { text: previewError.value, type: "error" };
  if (previewLoading.value) return { text: "Syncing preview\u2026", type: "syncing" };
  return previewRoute.value
    ? { text: "Preview synced", type: "ready" }
    : { text: "Preview unavailable", type: "neutral" };
});

const previewDistance = computed(() => distanceLabel(previewRoute.value));

function stopPlayback() {
  playing.value = false;
  cancelAnimationFrame(playRaf);
  playRaf = 0;
}

function tickAnimation(timestamp) {
  if (!playing.value) return;
  const elapsed = (timestamp - playStart) / 1000;
  const duration = route.durationSeconds || 8;
  const progress = Math.min(playFrom + elapsed / duration, 1);
  previewProgress.value = progress;
  if (progress >= 1) {
    stopPlayback();
    return;
  }
  playRaf = requestAnimationFrame(tickAnimation);
}

function togglePlay() {
  if (playing.value) {
    stopPlayback();
  } else {
    if (previewProgress.value >= 1) previewProgress.value = 0;
    playFrom = previewProgress.value;
    playStart = performance.now();
    playing.value = true;
    playRaf = requestAnimationFrame(tickAnimation);
  }
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}

function toggleQueue() {
  queueOpen.value = !queueOpen.value;
}

const activeJobCount = computed(() => jobs.value.filter(j => j.status === "pending" || j.status === "processing").length);

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
    start: { ...defaults.start, ...(nextRoute.start ?? nextRoute.from ?? {}) },
    end: { ...defaults.end, ...(nextRoute.end ?? nextRoute.to ?? {}) },
    path: nextRoute.path ?? defaults.path,
    camera: {
      ...defaults.camera,
      ...nextCamera,
      maxAltitude: nextCamera.maxAltitude ?? (nextCamera.peakAltitude != null ? 50 + Number(nextCamera.peakAltitude) : defaults.camera.maxAltitude),
      aggressiveness: nextCamera.aggressiveness ?? nextCamera.curvePosition ?? defaults.camera.aggressiveness
    }
  });
}

async function savePreset() {
  const payload = await requestJson("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: presetName.value || route.name || "Route preset", route: JSON.parse(JSON.stringify(route)) })
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
  sidebarOpen.value = false;
}

async function queueRender() {
  if (!canQueueRender.value) return;
  await requestJson("/api/render-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route: JSON.parse(JSON.stringify(route)) })
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
  route[kind] = { label: result.label, query: result.query, coords: result.coords };
  searchState[`${kind}Results`] = [];
  schedulePreview(0);
}

function updateLocationQuery(kind, query) {
  route[kind] = { ...route[kind], label: "", query, coords: null };
  if (!query.trim()) searchState[`${kind}Results`] = [];
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
  if (timerName === "startSearchTimer") startSearchTimer = handle;
  else endSearchTimer = handle;
}

function schedulePreview(delayMs = 320) {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    if (!previewReady.value || transitNeedsPresetPath.value) {
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
        headers: { "Content-Type": "application/json" },
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

watch(() => route.start.query, (query) => scheduleSearch("start", query));
watch(() => route.end.query, (query) => scheduleSearch("end", query));
watch(route, () => schedulePreview(), { deep: true, immediate: true });

let clickOutsideHandler = null;

onMounted(async () => {
  await Promise.all([loadPresets(), loadJobs()]);
  events = new EventSource("/api/render-events");
  events.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    jobs.value = payload.jobs;
  };
  clickOutsideHandler = (e) => {
    const wrap = document.querySelector(".queue-trigger-wrap");
    if (queueOpen.value && wrap && !wrap.contains(e.target)) {
      queueOpen.value = false;
    }
  };
  document.addEventListener("click", clickOutsideHandler);
});

onBeforeUnmount(() => {
  window.clearTimeout(startSearchTimer);
  window.clearTimeout(endSearchTimer);
  window.clearTimeout(previewTimer);
  cancelAnimationFrame(playRaf);
  events?.close();
  if (clickOutsideHandler) document.removeEventListener("click", clickOutsideHandler);
});
</script>

<template>
  <div class="app-shell">
    <!-- Header -->
    <header class="app-header">
      <div class="app-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
        MapAnim
      </div>
      <div class="header-actions">
        <div class="queue-trigger-wrap">
          <button class="btn btn-sm queue-trigger" @click="toggleQueue" :class="{ active: queueOpen }" :title="`${jobs.length} render job${jobs.length === 1 ? '' : 's'}`">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span v-if="activeJobCount" class="queue-blip">{{ activeJobCount }}</span>
          </button>
          <div v-if="queueOpen" class="queue-dropdown" @click.stop>
            <div class="queue-dropdown-header">
              <span>Render Queue</span>
              <span class="queue-count">{{ jobs.length }} job{{ jobs.length === 1 ? '' : 's' }}</span>
            </div>
            <div v-if="!jobs.length" class="queue-empty">No render jobs queued yet.</div>
            <div v-else class="queue-dropdown-list">
              <article
                v-for="job in jobs"
                :key="job.id"
                class="queue-item"
                :data-status="job.status"
              >
                <div class="queue-item-title">{{ job.summary?.name || (job.summary?.startLabel || 'Unknown') + ' → ' + (job.summary?.endLabel || 'Unknown') }}</div>
                <div class="queue-item-route">{{ (job.summary?.startLabel || 'Unknown start') }} → {{ (job.summary?.endLabel || 'Unknown end') }}</div>
                <div class="queue-item-row">
                  <span>{{ job.summary?.mode || "walking" }} · {{ job.summary?.mapType || "satellite" }}</span>
                  <span class="queue-status-badge" :class="job.status || 'pending'">{{ job.status }}</span>
                </div>
                <div class="queue-item-row">
                  <span>{{ job.stage }}</span>
                  <span>{{ job.progress ? (job.progress.frame != null ? `${job.progress.frame}/${job.progress.totalFrames ?? 0} frames` : typeof job.progress.percent === 'number' ? `${Math.round(job.progress.percent)}%` : job.stage) : job.stage }}</span>
                </div>
                <div v-if="typeof job.progress?.percent === 'number'" class="queue-bar">
                  <div class="queue-bar-fill" :style="{ width: `${Math.max(4, job.progress.percent)}%` }" />
                </div>
                <div v-if="job.error" class="queue-error">{{ job.error }}</div>
                <a
                  v-if="job.result?.outputUrl"
                  class="queue-link"
                  :href="job.result.outputUrl"
                  target="_blank"
                  rel="noreferrer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                  Open MP4
                </a>
              </article>
            </div>
          </div>
        </div>
        <button class="btn btn-sm" @click="toggleSidebar" :class="{ 'sidebar-toggle': true }">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>
    </header>

    <!-- Sidebar overlay for mobile -->
    <div class="overlay" :class="{ active: sidebarOpen }" @click="sidebarOpen = false" />

    <!-- Sidebar -->
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-inner">
        <!-- Route Setup -->
        <div class="section">
          <div class="section-header">
            <h2>Route Setup</h2>
            <span class="meta">
              <span>{{ routeSummaryLabel }}</span>
            </span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label class="field">
              <span class="field-label">Route name</span>
              <input v-model="route.name" class="text-input" placeholder="e.g. Airport hop" />
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
          <div class="button-row" style="margin-top:12px;">
            <button type="button" class="btn btn-primary" :disabled="!canQueueRender" @click="queueRender">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              Queue render
            </button>
            <button type="button" class="btn" @click="savePreset">Save preset</button>
            <button type="button" class="btn btn-danger" @click="resetRoute">Reset</button>
          </div>
        </div>

        <div class="section-divider" />

        <!-- Locations -->
        <div class="section">
          <div class="section-header"><h2>Locations</h2></div>
          <div style="display:flex;flex-direction:column;gap:10px;">
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
            <div class="field-row">
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
                <span class="field-label">Map style</span>
                <select v-model="route.mapType" class="select-input">
                  <option value="satellite">Satellite</option>
                  <option value="standard">Standard</option>
                </select>
              </label>
            </div>
            <div v-if="transitNeedsPresetPath" class="field-hint" style="color:var(--warning);">
              Public transport requires a preset with path coordinates.
            </div>
          </div>
        </div>

        <div class="section-divider" />

        <!-- Camera & Motion -->
        <div class="section">
          <div class="section-header"><h2>Camera &amp; Motion</h2></div>
          <CurveEditor
            :camera="route.camera"
            :progress="previewProgress"
            :route="previewRoute"
            @update-camera="route.camera = $event"
          />
          <TimingCurveEditor
            :camera="route.camera"
            :progress="previewProgress"
            @update-camera="route.camera = $event"
          />
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
            <div class="field-row">
              <label class="field">
                <span class="field-label">Duration (s)</span>
                <input v-model.number="route.durationSeconds" class="text-input" type="number" min="4" max="20" step="0.5" />
              </label>
              <label class="field">
                <span class="field-label">Max altitude</span>
                <input v-model.number="route.camera.maxAltitude" class="text-input" type="number" min="50" max="150" step="1" />
              </label>
            </div>
            <div class="field-row-3">
              <label class="field">
                <span class="field-label">Start zoom</span>
                <input v-model.number="route.camera.startZoom" class="text-input" type="number" min="3" max="18" step="0.1" />
              </label>
              <label class="field">
                <span class="field-label">End zoom</span>
                <input v-model.number="route.camera.endZoom" class="text-input" type="number" min="3" max="18" step="0.1" />
              </label>
              <label class="field">
                <span class="field-label">Smoothing</span>
                <input v-model.number="route.camera.smoothing" class="text-input" type="number" min="0" max="1" step="0.01" />
              </label>
            </div>
            <label class="field">
              <span class="field-label">Lerp aggressiveness</span>
              <input v-model.number="route.camera.aggressiveness" class="text-input" type="number" min="0" max="100" step="1" />
            </label>
          </div>
        </div>

        <div class="section-divider" />

        <!-- Presets -->
        <div class="section">
          <div class="section-header">
            <h2>Presets</h2>
            <span class="meta"><span>{{ presets.length }} saved</span></span>
          </div>
          <div class="preset-list">
            <div v-if="!presets.length" class="field-hint">No presets saved yet.</div>
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
        </div>
      </div>
    </aside>

    <!-- Main workspace -->
    <main class="workspace">
      <RenderPreview :route="previewRoute" :progress="previewProgress" />

      <!-- Overlay controls on top of preview -->
      <div class="preview-overlay">
        <div class="preview-overlay-top">
          <div class="preview-badges">
            <span v-if="previewLocationLabel" class="preview-location-chip">{{ previewLocationLabel }}</span>
            <span v-if="previewDistance" class="badge badge-green">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22c-4-3.5-8-7-8-11a8 8 0 0116 0c0 4-4 7.5-8 11z" /></svg>
              {{ previewDistance }}
            </span>
            <span class="badge" :class="{
              'badge-green': previewStatus.type === 'ready',
              'badge-blue': previewStatus.type === 'syncing',
              'badge-red': previewStatus.type === 'error',
              'badge-neutral': previewStatus.type === 'neutral'
            }">
              <span class="status-dot" :class="{
                green: previewStatus.type === 'ready',
                yellow: previewStatus.type === 'syncing',
                red: previewStatus.type === 'error',
                muted: previewStatus.type === 'neutral'
              }" />
              {{ previewStatus.text }}
            </span>
          </div>
        </div>
        <div class="preview-overlay-bottom">
          <div class="timeline">
            <div class="timeline-meta">
              <button
                class="btn btn-sm play-btn"
                :disabled="!previewRoute"
                :title="playing ? 'Pause' : 'Play'"
                :aria-label="playing ? 'Pause preview playback' : 'Play preview playback'"
                @click="togglePlay"
              >
                <svg v-if="!playing" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3" /></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="3" width="4" height="18" /><rect x="15" y="3" width="4" height="18" /></svg>
              </button>
            </div>
            <input id="preview-progress" v-model.number="previewProgress" type="range" min="0" max="1" step="0.01" @input="stopPlayback" />
            <strong>{{ Math.round(previewProgress * 100) }}%</strong>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
