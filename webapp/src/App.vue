<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import CurveEditor from "./components/CurveEditor.vue";
import TimingCurveEditor from "./components/TimingCurveEditor.vue";
import RenderPreview from "./components/RenderPreview.vue";
import SearchField from "./components/SearchField.vue";
import LocationSearchModal from "./components/LocationSearchModal.vue";
import type {
  CameraConfig,
  FormCamera,
  FormLocation,
  LocationSpec,
  PreparedRoute,
  PresetDetail,
  PresetItem,
  PreviewResponse,
  ProviderSearchResult,
  RenderJobsResponse,
  RouteApplyInput,
  RouteConfig,
  RouteFormData,
  SearchKind,
  SearchResponse,
  SearchState,
  SerializedJob
} from "./types.js";

function createDefaultRoute(): RouteFormData {
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
      timingInverted: false,
      clipPath: false
    },
    avatarScale: 1,
    avatarBorderWidth: 3,
    avatarBorderColor: "#ffffff",
    avatarBgColor: "",
    avatarShape: "circle" as const
  };
}

async function requestJson<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function toLocationSpec(location: FormLocation): LocationSpec {
  const payload: LocationSpec = {};
  if (location.label) {
    payload.label = location.label;
  }
  if (location.query) {
    payload.query = location.query;
  }
  if (location.coords) {
    payload.coords = location.coords;
  }
  return payload;
}

function toRouteConfig(route: RouteFormData): RouteConfig {
  const { start, end, path, camera, ...rest } = route;
  return {
    ...rest,
    start: toLocationSpec(start),
    end: toLocationSpec(end),
    camera: { ...camera },
    ...(path ? { path } : {})
  };
}

function normalizeLocationInput(location?: Partial<FormLocation> | RouteConfig["start"]): FormLocation {
  if (!location) {
    return { label: "", query: "", coords: null };
  }

  const coords =
    Array.isArray(location.coords) && location.coords.length === 2
      ? [Number(location.coords[0]), Number(location.coords[1])] as [number, number]
      : null;

  return {
    label: typeof location.label === "string" ? location.label : "",
    query: typeof location.query === "string" ? location.query : "",
    coords
  };
}

function setSearchResults(kind: SearchKind, results: ProviderSearchResult[]): void {
  if (kind === "start") {
    searchState.startResults = results;
    return;
  }

  searchState.endResults = results;
}

function setSearchLoading(kind: SearchKind, loading: boolean): void {
  if (kind === "start") {
    searchState.startLoading = loading;
    return;
  }

  searchState.endLoading = loading;
}

function distanceLabel(route: PreparedRoute | null): string | null {
  const meters = route?.path?.distanceMeters;
  if (!meters) return null;
  return meters > 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

const route = reactive<RouteFormData>(createDefaultRoute());
const previewRoute = ref<PreparedRoute | null>(null);
const previewProgress = ref(0);
const previewError = ref("");
const previewLoading = ref(false);
const presetName = ref("");
const saveModalOpen = ref(false);
const saveModalName = ref("");
const loadModalOpen = ref(false);
const resetModalOpen = ref(false);
const searchModalOpen = ref(false);
const avatarModalOpen = ref(false);
const searchModalKind = ref<SearchKind>("start");
const presets = ref<PresetItem[]>([]);
const jobs = ref<SerializedJob[]>([]);
const searchState = reactive<SearchState>({
  startResults: [],
  endResults: [],
  startLoading: false,
  endLoading: false
});
const avatarPreviewUrl = computed<string | null>(() => route.avatarUrl ?? null);

function handleAvatarUpload(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) return;
  if (file.size > 2 * 1024 * 1024) return;
  const reader = new FileReader();
  reader.onload = () => { route.avatarUrl = reader.result as string; };
  reader.readAsDataURL(file);
}

function clearAvatar(): void {
  route.avatarUrl = undefined;
}

function avatarPreviewRadius(shape?: string): string {
  if (shape === "square") return "0";
  if (shape === "rounded") return "22%";
  return "50%";
}

const avatarBgTransparent = computed({
  get: () => !route.avatarBgColor,
  set: (v: boolean) => { route.avatarBgColor = v ? "" : "#ffffff"; }
});

const sidebarOpen = ref(false);
const queueOpen = ref(false);
const infoOpen = ref(false);
const darkMode = ref(localStorage.getItem("theme") !== "light");

watch(darkMode, (v: boolean) => {
  document.documentElement.setAttribute("data-theme", v ? "dark" : "light");
  localStorage.setItem("theme", v ? "dark" : "light");
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (meta) meta.content = v ? "#0e1117" : "#ffffff";
}, { immediate: true });

const playing = ref(false);
let playRaf = 0;
let playStart = 0;
let playFrom = 0;

let events: EventSource | null = null;
let visibilityChangeHandler: (() => void) | null = null;
let startSearchTimer: ReturnType<typeof setTimeout> | undefined;
let endSearchTimer: ReturnType<typeof setTimeout> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
const baseTitle = document.title;

const previewReady = computed<boolean>(() => Boolean(route.start.query.trim() && route.end.query.trim()));
const canQueueRender = computed<boolean>(() => previewReady.value);
const routeSummaryLabel = computed<string>(() => route.name || route.id || "Untitled route");
const previewLocationLabel = computed<string>(() => {
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
const previewStatus = computed<{ text: string; type: string }>(() => {
  if (!previewReady.value) return { text: "Enter both locations to load a preview", type: "neutral" };
  if (previewError.value) return { text: previewError.value, type: "error" };
  if (previewLoading.value) return { text: "Syncing preview\u2026", type: "syncing" };
  return previewRoute.value
    ? { text: "Preview synced", type: "ready" }
    : { text: "Preview unavailable", type: "neutral" };
});

const previewDistance = computed<string | null>(() => distanceLabel(previewRoute.value));

function stopPlayback(): void {
  playing.value = false;
  cancelAnimationFrame(playRaf);
  playRaf = 0;
}

function tickAnimation(timestamp: number): void {
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

function togglePlay(): void {
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

function toggleSidebar(): void {
  sidebarOpen.value = !sidebarOpen.value;
}

function toggleQueue(): void {
  queueOpen.value = !queueOpen.value;
}

const activeRenderStatuses = new Set<SerializedJob["status"]>(["queued", "running"]);
const activeJobCount = computed<number>(() => jobs.value.filter((job) => activeRenderStatuses.has(job.status)).length);

watch(activeJobCount, (count: number) => {
  document.title = count ? `(${count}) ${baseTitle}` : baseTitle;
});

async function loadPresets(): Promise<void> {
  const payload = await requestJson<{ presets: PresetItem[] }>("/api/presets");
  presets.value = payload.presets;
}

async function loadJobs(): Promise<void> {
  const payload = await requestJson<RenderJobsResponse>("/api/render-jobs");
  jobs.value = payload.jobs;
}

function applyRoute(nextRoute: RouteApplyInput): void {
  const defaults = createDefaultRoute();
  const nextCamera: Partial<FormCamera & CameraConfig> = nextRoute.camera ?? {};
  Object.assign(route, defaults, nextRoute, {
    start: { ...defaults.start, ...normalizeLocationInput(nextRoute.start ?? nextRoute.from) },
    end: { ...defaults.end, ...normalizeLocationInput(nextRoute.end ?? nextRoute.to) },
    path: nextRoute.path ?? defaults.path,
    camera: {
      ...defaults.camera,
      ...nextCamera,
      maxAltitude: nextCamera.maxAltitude ?? (nextCamera.peakAltitude != null ? 50 + Number(nextCamera.peakAltitude) : defaults.camera.maxAltitude),
      aggressiveness: nextCamera.aggressiveness ?? nextCamera.curvePosition ?? defaults.camera.aggressiveness
    }
  });
}

function openSaveModal(): void {
  saveModalName.value = presetName.value || route.name || "";
  saveModalOpen.value = true;
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(".modal .text-input");
    if (input) input.focus();
  });
}

async function confirmSave(): Promise<void> {
  const name = saveModalName.value.trim() || route.name || "Route preset";
  const payload = await requestJson<PresetDetail>("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, route: toRouteConfig(route) })
  });
  presetName.value = payload.name;
  route.id = payload.route.id ?? route.id;
  route.name = payload.route.name ?? route.name;
  saveModalOpen.value = false;
  await loadPresets();
}

async function loadPreset(id: string): Promise<void> {
  const payload = await requestJson<PresetDetail>(`/api/presets/${encodeURIComponent(id)}`);
  applyRoute(payload.route);
  presetName.value = payload.name ?? payload.route.name ?? "";
  previewProgress.value = 0;
  schedulePreview(0);
  loadModalOpen.value = false;
}

async function queueRender(): Promise<void> {
  if (!canQueueRender.value) return;
  await requestJson("/api/render-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route: toRouteConfig(route) })
  });
}

async function cancelRender(jobId: string): Promise<void> {
  await requestJson(`/api/render-jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE"
  });
}

function resetRoute(): void {
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

function confirmReset(): void {
  resetRoute();
  resetModalOpen.value = false;
}

function applySearchResult(kind: "start" | "end", result: ProviderSearchResult): void {
  route[kind] = { label: result.label, query: result.query, coords: result.coords };
  setSearchResults(kind, []);
  schedulePreview(0);
}

function openSearchModal(kind: SearchKind): void {
  searchModalKind.value = kind;
  searchModalOpen.value = true;
}

function closeSearchModal(): void {
  searchModalOpen.value = false;
}

function onSearchModalQueryUpdate(value: string): void {
  updateLocationQuery(searchModalKind.value, value);
}

function onSearchModalSelect(result: ProviderSearchResult): void {
  applySearchResult(searchModalKind.value, result);
  closeSearchModal();
}

function updateLocationQuery(kind: "start" | "end", query: string): void {
  route[kind] = { ...route[kind], label: "", query, coords: null };
  if (!query.trim()) setSearchResults(kind, []);
  schedulePreview(0);
}

function scheduleSearch(kind: "start" | "end", query: string): void {
  const timerRef = kind === "start" ? startSearchTimer : endSearchTimer;
  window.clearTimeout(timerRef);
  const handle = window.setTimeout(async () => {
    if (!query || query.trim().length < 3) {
      setSearchResults(kind, []);
      setSearchLoading(kind, false);
      return;
    }
    setSearchLoading(kind, true);
    try {
      const payload = await requestJson<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`);
      setSearchResults(kind, payload.results);
    } catch (error) {
      console.error(error);
    } finally {
      setSearchLoading(kind, false);
    }
  }, 260);
  if (kind === "start") startSearchTimer = handle;
  else endSearchTimer = handle;
}

function schedulePreview(delayMs: number = 320): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    if (!previewReady.value) {
      previewRoute.value = null;
      previewError.value = "";
      previewLoading.value = false;
      return;
    }
    const payload = toRouteConfig(route);
    previewLoading.value = true;
    previewError.value = "";
    try {
      const preview = await requestJson<PreviewResponse>("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route: payload })
      });
      previewRoute.value = preview.route;
    } catch (error: unknown) {
      previewRoute.value = null;
      previewError.value = error instanceof Error ? error.message : String(error);
    } finally {
      previewLoading.value = false;
    }
  }, delayMs);
}

watch(() => route.start.query, (query: string) => scheduleSearch("start", query));
watch(() => route.end.query, (query: string) => scheduleSearch("end", query));
watch(route, () => schedulePreview(), { deep: true, immediate: true });

let clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

onMounted(async () => {
  await Promise.all([loadPresets(), loadJobs()]);
  events = new EventSource("/api/render-events");
  events.onmessage = (event) => {
    const payload = JSON.parse(event.data) as RenderJobsResponse;
    jobs.value = payload.jobs;
  };
  pollTimer = window.setInterval(loadJobs, 30_000);
  visibilityChangeHandler = () => {
    if (!document.hidden) loadJobs();
  };
  document.addEventListener("visibilitychange", visibilityChangeHandler);
  clickOutsideHandler = (e) => {
    const queueWrap = document.querySelector(".queue-trigger-wrap");
    if (queueOpen.value && queueWrap && e.target instanceof Node && !queueWrap.contains(e.target)) {
      queueOpen.value = false;
    }
    const infoWrap = document.querySelector(".info-trigger-wrap");
    if (infoOpen.value && infoWrap && e.target instanceof Node && !infoWrap.contains(e.target)) {
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
  if (visibilityChangeHandler) document.removeEventListener("visibilitychange", visibilityChangeHandler);
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
                <div class="queue-item-actions">
                  <button
                    v-if="job.status === 'queued' || job.status === 'running'"
                    type="button"
                    class="queue-cancel-btn"
                    title="Cancel render"
                    @click="cancelRender(job.id)"
                  >&times;</button>
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
                </div>
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
            <label class="field">
              <span class="field-label">Avatar marker</span>
              <div class="avatar-upload-row">
                <button v-if="avatarPreviewUrl" type="button" class="avatar-preview-wrap" @click="avatarModalOpen = true" title="Edit avatar">
                  <img :src="avatarPreviewUrl" class="avatar-preview-thumb" alt="Avatar" />
                </button>
                <label v-else class="avatar-upload-btn">
                  <span>Choose image</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" class="avatar-file-input" @change="handleAvatarUpload" />
                </label>
              </div>
              <span class="field-hint">PNG/JPG, shown as a circle on the route</span>
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
              :modal-active="searchModalOpen && searchModalKind === 'start'"
              @update:model-value="updateLocationQuery('start', $event)"
              @select="applySearchResult('start', $event)"
              @open-modal="openSearchModal('start')"
            />
            <SearchField
              :model-value="route.end.query"
              label="Destination"
              :results="searchState.endResults"
              :loading="searchState.endLoading"
              :selected-label="route.end.label"
              :modal-active="searchModalOpen && searchModalKind === 'end'"
              @update:model-value="updateLocationQuery('end', $event)"
              @select="applySearchResult('end', $event)"
              @open-modal="openSearchModal('end')"
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
            <label class="field">
              <span class="field-label">Duration (s)</span>
              <input v-model.number="route.durationSeconds" class="text-input" type="number" min="4" max="20" step="0.5" />
            </label>
            <label class="field">
              <span class="field-label">Smoothing</span>
              <input v-model.number="route.camera.smoothing" class="text-input" type="number" min="0" max="1" step="0.01" />
            </label>
            <label class="field">
              <span class="field-label">Lerp aggressiveness</span>
              <input v-model.number="route.camera.aggressiveness" class="text-input" type="number" min="0" max="100" step="1" />
            </label>
            <label class="field">
              <span class="field-label">Clip path to camera</span>
              <select v-model="route.camera.clipPath" class="select-input">
                <option :value="false">Off</option>
                <option :value="true">On</option>
              </select>
            </label>
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

      <!-- Avatar Config Modal -->
      <div v-if="avatarModalOpen" class="modal-backdrop" @click.self="avatarModalOpen = false">
        <div class="modal">
          <h3 class="modal-title">Avatar Settings</h3>
          <div class="avatar-modal-preview">
            <img v-if="avatarPreviewUrl" :src="avatarPreviewUrl" alt="Avatar preview"
              :style="{
                width: Math.round(40 * (route.avatarScale ?? 1)) + 'px',
                height: Math.round(40 * (route.avatarScale ?? 1)) + 'px',
                borderRadius: avatarPreviewRadius(route.avatarShape),
                objectFit: 'cover',
                border: (route.avatarBorderWidth ?? 3) + 'px solid ' + (route.avatarBorderColor ?? '#ffffff'),
                background: route.avatarBgColor || 'transparent'
              }"
            />
          </div>
          <label class="field">
            <span class="field-label">Shape</span>
            <select v-model="route.avatarShape" class="select-input">
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="rounded">Rounded square</option>
            </select>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">Scale</span>
              <input v-model.number="route.avatarScale" class="text-input" type="number" min="0.5" max="2" step="0.1" />
            </label>
            <label class="field">
              <span class="field-label">Border width</span>
              <input v-model.number="route.avatarBorderWidth" class="text-input" type="number" min="0" max="6" step="0.5" />
            </label>
          </div>
          <label class="field">
            <span class="field-label">Border color</span>
            <input v-model="route.avatarBorderColor" class="text-input" type="color" />
          </label>
          <label class="field">
            <span class="field-label">Background</span>
            <div class="avatar-bg-row">
              <input v-model="route.avatarBgColor" class="text-input" type="color" :disabled="avatarBgTransparent" />
              <label class="avatar-transparent-toggle">
                <input type="checkbox" v-model="avatarBgTransparent" />
                <span>Transparent</span>
              </label>
            </div>
            <span class="field-hint">For images with transparent backgrounds</span>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn btn-danger" @click="clearAvatar(); avatarModalOpen = false">Remove</button>
            <button type="button" class="btn btn-primary" @click="avatarModalOpen = false">Done</button>
          </div>
        </div>
      </div>

      <!-- Location Search Modal -->
      <LocationSearchModal
        :open="searchModalOpen"
        :label="searchModalKind === 'start' ? 'Origin' : 'Destination'"
        :query="searchModalKind === 'start' ? route.start.query : route.end.query"
        :results="searchModalKind === 'start' ? searchState.startResults : searchState.endResults"
        :loading="searchModalKind === 'start' ? searchState.startLoading : searchState.endLoading"
        @update:query="onSearchModalQueryUpdate"
        @select="onSearchModalSelect"
        @close="closeSearchModal"
      />
    </Teleport>
  </div>
</template>
