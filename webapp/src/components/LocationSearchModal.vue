<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import maplibregl from "maplibre-gl";
import type { ProviderSearchResult } from "../types.js";
import { ensureTileCacheReady } from "../tile-cache.js";

const props = withDefaults(defineProps<{
  open: boolean;
  label: string;
  query: string;
  results: ProviderSearchResult[];
  loading?: boolean;
}>(), {
  loading: false
});

const emit = defineEmits<{
  (e: "update:query", value: string): void;
  (e: "select", result: ProviderSearchResult): void;
  (e: "close"): void;
}>();

const mapContainer = ref<HTMLDivElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const highlightedId = ref<string | null>(null);

let map: maplibregl.Map | null = null;
let markers: maplibregl.Marker[] = [];

const standardStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["/tiles/standard/{z}/{x}/{y}"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }
  },
  layers: [
    {
      id: "carto-base",
      type: "raster",
      source: "carto"
    }
  ]
};

function createMarkerElement(result: ProviderSearchResult, index: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "search-marker";
  el.textContent = String(index + 1);
  el.dataset.resultId = result.id;
  el.addEventListener("click", (event: MouseEvent) => {
    event.stopPropagation();
    highlightedId.value = result.id;
  });
  return el;
}

function syncMarkers(): void {
  if (!map) return;

  for (const marker of markers) {
    marker.remove();
  }
  markers = [];

  if (!props.results.length) return;

  for (let i = 0; i < props.results.length; i++) {
    const result = props.results[i];
    const el = createMarkerElement(result, i);
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(result.coords)
      .addTo(map);
    markers.push(marker);
  }

  if (props.results.length === 1) {
    map.flyTo({ center: props.results[0].coords, zoom: 12, duration: 600 });
  } else {
    const bounds = new maplibregl.LngLatBounds();
    for (const result of props.results) {
      bounds.extend(result.coords);
    }
    map.fitBounds(bounds, { padding: 60, duration: 600, maxZoom: 14 });
  }
}

async function initMap(): Promise<void> {
  if (!mapContainer.value) return;
  await ensureTileCacheReady();

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: standardStyle,
    center: [0, 20],
    zoom: 2,
    attributionControl: false
  });

  map.on("load", () => {
    syncMarkers();
    if (searchInput.value) {
      searchInput.value.focus();
    }
  });
}

function destroyMap(): void {
  for (const marker of markers) {
    marker.remove();
  }
  markers = [];
  if (map) {
    map.remove();
    map = null;
  }
}

watch(() => props.open, async (isOpen: boolean) => {
  if (isOpen) {
    await nextTick();
    await initMap();
  } else {
    destroyMap();
    highlightedId.value = null;
  }
});

watch(() => props.results, () => {
  syncMarkers();
}, { deep: true });

function onInput(event: Event): void {
  if (event.target instanceof HTMLInputElement) {
    emit("update:query", event.target.value);
  }
}

function selectResult(result: ProviderSearchResult): void {
  emit("select", result);
}

watch(highlightedId, (id: string | null) => {
  if (!map) return;

  // Update marker styles
  for (let i = 0; i < markers.length; i++) {
    const el = markers[i].getElement();
    if (props.results[i]?.id === id) {
      el.classList.add("highlighted");
      map.flyTo({ center: props.results[i].coords, zoom: Math.max(map.getZoom(), 6), duration: 400 });
    } else {
      el.classList.remove("highlighted");
    }
  }

  // Scroll result into view
  if (id) {
    const el = document.querySelector(`.search-modal-result[data-id="${id}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
});

onBeforeUnmount(() => {
  destroyMap();
});
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal search-modal">
      <div class="search-modal-header">
        <h3 class="modal-title">Select {{ label }}</h3>
        <button class="btn btn-sm" @click="$emit('close')" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="search-modal-input-row">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref="searchInput"
          :value="query"
          class="text-input"
          placeholder="Search for a place"
          @input="onInput"
          @keydown.escape="$emit('close')"
        />
        <div v-if="loading" class="search-spinner" />
      </div>
      <div class="search-modal-body">
        <div ref="mapContainer" class="search-modal-map" />
        <div class="search-modal-results">
          <div v-if="loading && !results.length" class="search-empty">Searching&hellip;</div>
          <div v-else-if="!results.length && query.length >= 3" class="search-empty">No results found</div>
          <div v-else-if="!results.length" class="search-empty">Type at least three characters</div>
          <button
            v-for="(result, index) in results"
            :key="result.id"
            :data-id="result.id"
            class="search-modal-result"
            :class="{ highlighted: highlightedId === result.id }"
            @mouseenter="highlightedId = result.id"
            @click="selectResult(result)"
          >
            <span class="search-modal-result-index">{{ index + 1 }}</span>
            <span class="search-modal-result-label">{{ result.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
