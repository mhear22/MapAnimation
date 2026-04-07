<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
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
const saveModalOpen = ref(false);
const saveModalName = ref("");
const loadModalOpen = ref(false);
const resetModalOpen = ref(false);
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
const infoOpen = ref(false);
const darkMode = ref(localStorage.getItem("theme") !== "light");

watch(darkMode, (v) => {
  document.documentElement.setAttribute("data-theme", v ? "dark" : "light");
  localStorage.setItem("theme", v ? "dark" : "light");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = v ? "#0e1117" : "#ffffff";
}, { immediate: true });

const playing = ref(false);
let playRaf = 0;
let playStart = 0;
let playFrom = 0;

let events = null;
let startSearchTimer = 0;
let endSearchTimer = 0;
let previewTimer = 0;
let pollTimer = 0;
const baseTitle = document.title;

const previewReady = computed(() => Boolean(route.start.query.trim() && route.end.query.trim()));
const canQueueRender = computed(() => previewReady.value);
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

watch(activeJobCount, (count) => {
  document.title = count ? `(${count}) ${baseTitle}` : baseTitle;
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

function openSaveModal() {
  saveModalName.value = presetName.value || route.name || "";
  saveModalOpen.value = true;
  nextTick(() => {
    const input = document.querySelector(".modal .text-input");
    if (input) input.focus();
  });
}

async function confirmSave() {
  const name = saveModalName.value.trim() || route.name || "Route preset";
  const payload = await requestJson("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, route: JSON.parse(JSON.stringify(route)) })
  });
  presetName.value = payload.name;
  route.id = payload.route.id;
  route.name = payload.route.name ?? route.name;
  saveModalOpen.value = false;
  await loadPresets();
}

async function loadPreset(id) {
  const payload = await requestJson(`/api/presets/${encodeURIComponent(id)}`);
  applyRoute(payload.route);
  presetName.value = payload.name ?? payload.route.name ?? "";
  previewProgress.value = 0;
  schedulePreview(0);
  loadModalOpen.value = false;
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

function confirmReset() {
  resetRoute();
  resetModalOpen.value = false;
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
    if (!previewReady.value) {
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
  pollTimer = window.setInterval(loadJobs, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadJobs();
  });
  clickOutsideHandler = (e) => {
    const queueWrap = document.querySelector(".queue-trigger-wrap");
    if (queueOpen.value && queueWrap && !queueWrap.contains(e.target)) {
      queueOpen.value = false;
    }
    const infoWrap = document.querySelector(".info-trigger-wrap");
    if (infoOpen.value && infoWrap && !infoWrap.contains(e.target)) {
      infoOpen.value = false;
    }
  };
  document.addEventListener("click", clickOutsideHandler);
});

onBeforeUnmount(() => {
  window.clearTimeout(startSearchTimer);
  window.clearTimeout(endSearchTimer);
  window.clearTimeout(previewTimer);
  window.clearInterval(pollTimer);
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
        <button class="btn btn-sm theme-toggle" @click="darkMode = !darkMode" :title="darkMode ? 'Switch to light mode' : 'Switch to dark mode'">
          <svg v-if="darkMode" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        </button>
        <div class="info-trigger-wrap">
          <button class="btn btn-sm info-toggle" @click="infoOpen = !infoOpen" :class="{ active: infoOpen }" title="About MapAnim">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </button>
          <div v-if="infoOpen" class="info-dropdown" @click.stop>
            <div class="info-dropdown-header">About MapAnim</div>
            <div class="info-dropdown-body">
              <p>MapAnim creates animated map route videos. Configure origin and destination points, choose a travel mode, adjust camera motion curves, and render smooth flyover animations as MP4.</p>
              <div class="info-divider" />
              <p class="info-credits-label">Built by</p>
              <p class="info-credits">Mika, <a href="https://z.ai/chat" target="_blank" rel="noreferrer">GLM</a>, and <a href="https://openai.com/codex" target="_blank" rel="noreferrer">Codex</a></p>
            </div>
          </div>
        </div>
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
      <div class="sidebar-scroll">
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
            </div>
            <div class="field-row">
              <label class="field">
                <span class="field-label">Smoothing</span>
                <input v-model.number="route.camera.smoothing" class="text-input" type="number" min="0" max="1" step="0.01" />
              </label>
              <label class="field">
                <span class="field-label">Lerp aggressiveness</span>
                <input v-model.number="route.camera.aggressiveness" class="text-input" type="number" min="0" max="100" step="1" />
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Persistent bottom panel -->
      <div class="sidebar-panel">
        <div class="sidebar-panel-actions">
          <button type="button" class="btn btn-primary sidebar-panel-btn" :disabled="!canQueueRender" @click="queueRender">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            Queue
          </button>
          <button type="button" class="btn sidebar-panel-btn" @click="openSaveModal">Save</button>
          <button type="button" class="btn sidebar-panel-btn" @click="loadModalOpen = true">Load</button>
          <button type="button" class="btn btn-danger sidebar-panel-btn" @click="resetModalOpen = true" title="Reset route">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></svg>
          </button>
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

    <!-- Save Preset Modal -->
    <Teleport to="body">
      <div v-if="saveModalOpen" class="modal-backdrop" @click.self="saveModalOpen = false">
        <div class="modal">
          <h3 class="modal-title">Save Preset</h3>
          <label class="field">
            <span class="field-label">Preset name</span>
            <input
              ref="saveModalInput"
              v-model="saveModalName"
              class="text-input"
              placeholder="e.g. Airport hop"
              @keydown.enter="confirmSave"
              @keydown.escape="saveModalOpen = false"
            />
          </label>
          <div class="modal-actions">
            <button type="button" class="btn" @click="saveModalOpen = false">Cancel</button>
            <button type="button" class="btn btn-primary" @click="confirmSave">Save</button>
          </div>
        </div>
      </div>

      <!-- Load Preset Modal -->
      <div v-if="loadModalOpen" class="modal-backdrop" @click.self="loadModalOpen = false">
        <div class="modal">
          <h3 class="modal-title">Load Preset</h3>
          <div v-if="!presets.length" class="field-hint" style="padding:8px 0;">No presets saved yet.</div>
          <div v-else class="modal-preset-list">
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
          <div class="modal-actions">
            <button type="button" class="btn" @click="loadModalOpen = false">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Reset Confirmation Modal -->
      <div v-if="resetModalOpen" class="modal-backdrop" @click.self="resetModalOpen = false">
        <div class="modal">
          <h3 class="modal-title">Reset Route</h3>
          <p style="font-size:13px;color:var(--text-secondary);">This will clear all route fields and return to defaults. Are you sure?</p>
          <div class="modal-actions">
            <button type="button" class="btn" @click="resetModalOpen = false">Cancel</button>
            <button type="button" class="btn btn-danger" @click="confirmReset">Reset</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
