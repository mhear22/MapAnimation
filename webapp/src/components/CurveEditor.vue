<script setup>
import { computed, onBeforeUnmount, ref } from "vue";

const props = defineProps({
  camera: {
    type: Object,
    required: true
  },
  progress: {
    type: Number,
    default: 0
  },
  route: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(["update-camera"]);

const width = 360;
const height = 220;
const minZoom = 2.2;
const maxZoom = 18;
const minAggressivenessControl = 0.02;
const maxAggressivenessControl = 0.98;
const mercatorTileSize = 512;
const holdIn = 0.08;
const holdOut = 0.08;
const margin = {
  top: 22,
  right: 18,
  bottom: 32,
  left: 24
};
const dragState = ref(null);
const svgRef = ref(null);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const ratio = (value - inMin) / (inMax - inMin || 1);
  return outMin + ratio * (outMax - outMin);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function depthToY(depth) {
  return mapRange(clamp(depth, 0, 1), 0, 1, margin.top, height - margin.bottom);
}

function halfProgressToX(progress) {
  return mapRange(clamp(progress, 0, 1), 0, 1, margin.left, width - margin.right);
}

function xToHalfProgress(x) {
  return mapRange(clamp(x, margin.left, width - margin.right), margin.left, width - margin.right, 0, 1);
}

function toAggressivenessControl(aggressiveness = 50) {
  return lerp(minAggressivenessControl, maxAggressivenessControl, clamp(aggressiveness, 0, 100) / 100);
}

function controlToAggressiveness(control) {
  return Math.round(
    mapRange(
      clamp(control, minAggressivenessControl, maxAggressivenessControl),
      minAggressivenessControl,
      maxAggressivenessControl,
      0,
      100
    )
  );
}

function sampleMirroredBlend(progress, aggressiveness = 50) {
  const t = clamp(progress, 0, 1);
  const control = toAggressivenessControl(aggressiveness);
  return 2 * (1 - t) * t * control + t * t;
}

function projectMercator([lng, lat]) {
  const sinLat = clamp(Math.sin(toRadians(lat)), -0.9999, 0.9999);
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)
  };
}

function fitBoundsZoom(coordinates, viewportWidth, viewportHeight, maxZoomValue) {
  if (!coordinates?.length) {
    return maxZoomValue;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const coordinate of coordinates) {
    const projected = projectMercator(coordinate);
    minX = Math.min(minX, projected.x);
    maxX = Math.max(maxX, projected.x);
    minY = Math.min(minY, projected.y);
    maxY = Math.max(maxY, projected.y);
  }

  const dx = Math.max(maxX - minX, 1e-6);
  const dy = Math.max(maxY - minY, 1e-6);
  const zoomX = Math.log2(viewportWidth / (mercatorTileSize * dx));
  const zoomY = Math.log2(viewportHeight / (mercatorTileSize * dy));
  return clamp(Math.min(zoomX, zoomY, maxZoomValue), minZoom, maxZoom);
}

const routeCoordinates = computed(() => {
  if (props.route?.path?.coordinates?.length >= 2) {
    return props.route.path.coordinates;
  }

  if (props.route?.from?.coords && props.route?.to?.coords) {
    return [props.route.from.coords, props.route.to.coords];
  }

  return [];
});

const startZoom = computed(() => clamp(Number(props.camera.startZoom ?? 15.8), minZoom, maxZoom));
const endZoom = computed(() => clamp(Number(props.camera.endZoom ?? startZoom.value), minZoom, maxZoom));
const maxAltitude = computed(() => clamp(Number(props.camera.maxAltitude ?? 100), 50, 150));
const aggressiveness = computed(() => clamp(Number(props.camera.aggressiveness ?? 50), 0, 100));

const baseOverviewZoom = computed(() => {
  const fallbackZoom = Math.max(minZoom, Math.max(startZoom.value, endZoom.value) - 1.6);
  if (!routeCoordinates.value.length) {
    return fallbackZoom;
  }

  const sceneWidth = Number(props.route?.width ?? 1920);
  const sceneHeight = Number(props.route?.height ?? 1080);
  const maxPadding = Math.max(24, Math.floor(Math.min(sceneWidth, sceneHeight) / 4) || 24);
  const paddingValue = Math.min(Number(props.route?.overviewPadding ?? 180), maxPadding);
  const viewportWidth = Math.max(80, sceneWidth - (paddingValue * 2 + 40));
  const viewportHeight = Math.max(80, sceneHeight - paddingValue * 2);
  return fitBoundsZoom(
    routeCoordinates.value,
    viewportWidth,
    viewportHeight,
    Math.max(startZoom.value, endZoom.value) - 0.8
  );
});

const peakZoom = computed(() => {
  const closerZoom = Math.max(startZoom.value, endZoom.value);
  const requiredZoomOut = Math.max(0, closerZoom - baseOverviewZoom.value);
  return clamp(closerZoom - requiredZoomOut * (maxAltitude.value / 100), minZoom, maxZoom);
});

function sampleHalfDepth(progress) {
  return sampleMirroredBlend(progress, aggressiveness.value);
}

const startPoint = computed(() => ({
  x: halfProgressToX(0),
  y: depthToY(0)
}));

const peakPoint = computed(() => ({
  x: halfProgressToX(1),
  y: depthToY(1)
}));

const handlePoint = computed(() => {
  const halfProgress = 0.5;
  return {
    x: halfProgressToX(halfProgress),
    y: depthToY(sampleHalfDepth(halfProgress))
  };
});

const mirroredHalfProgress = computed(() => {
  const mapped = clamp((props.progress - holdIn) / (1 - holdIn - holdOut), 0, 1);
  return mapped <= 0.5 ? mapped / 0.5 : (1 - mapped) / 0.5;
});

const currentPoint = computed(() => ({
  x: halfProgressToX(mirroredHalfProgress.value),
  y: depthToY(sampleHalfDepth(mirroredHalfProgress.value))
}));

const pathData = computed(() => {
  const samples = [];
  const sampleCount = 48;

  for (let index = 0; index < sampleCount; index += 1) {
    const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    samples.push(`${index === 0 ? "M" : "L"} ${halfProgressToX(progress)} ${depthToY(sampleHalfDepth(progress))}`);
  }

  return samples.join(" ");
});

const gridLines = computed(() => {
  const values = [];

  for (let index = 0; index < 5; index += 1) {
    const ratio = index / 4;
    values.push(margin.top + ratio * (height - margin.top - margin.bottom));
  }

  return values;
});

function updateCamera(nextValues) {
  emit("update-camera", {
    ...props.camera,
    ...nextValues
  });
}

function getLocalPoint(event) {
  const bounds = svgRef.value?.getBoundingClientRect();
  return {
    x: event.clientX - (bounds?.left ?? 0),
    y: event.clientY - (bounds?.top ?? 0)
  };
}

function onPointerMove(event) {
  if (!dragState.value) {
    return;
  }

  const point = getLocalPoint(event);
  const halfProgress = xToHalfProgress(point.x);
  const targetBlend = clamp(
    mapRange(point.y, startPoint.value.y, peakPoint.value.y || startPoint.value.y + 1, 0, 1),
    0,
    1
  );

  const control = clamp(
    (targetBlend - halfProgress * halfProgress) / (2 * (1 - halfProgress) * halfProgress || 1),
    minAggressivenessControl,
    maxAggressivenessControl
  );
  updateCamera({
    aggressiveness: controlToAggressiveness(control)
  });
}

function stopDrag() {
  dragState.value = null;
}

function startDrag(event) {
  dragState.value = "handle";
  onPointerMove(event);
}

window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", stopDrag);

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", stopDrag);
});
</script>

<template>
  <div class="curve-editor">
    <div class="curve-summary">
      <div>Start<br />{{ camera.startZoom.toFixed(1) }}x</div>
      <div>Far<br />{{ peakZoom.toFixed(1) }}x @ {{ camera.maxAltitude }}%</div>
      <div>End<br />{{ camera.endZoom.toFixed(1) }}x</div>
    </div>
    <svg
      ref="svgRef"
      class="curve-canvas"
      :viewBox="`0 0 ${width} ${height}`"
    >
      <rect class="curve-bg" :x="0" :y="0" :width="width" :height="height" />
      <line
        v-for="lineY in gridLines"
        :key="lineY"
        class="curve-grid"
        :x1="margin.left"
        :x2="width - margin.right"
        :y1="lineY"
        :y2="lineY"
      />
      <line class="curve-axis" :x1="margin.left" :x2="margin.left" :y1="margin.top" :y2="height - margin.bottom" />
      <line
        class="curve-axis"
        :x1="margin.left"
        :x2="width - margin.right"
        :y1="height - margin.bottom"
        :y2="height - margin.bottom"
      />
      <line
        class="curve-progress"
        :x1="currentPoint.x"
        :x2="currentPoint.x"
        :y1="margin.top"
        :y2="height - margin.bottom"
      />
      <path class="curve-path" :d="pathData" />
      <line
        class="curve-guide"
        :x1="handlePoint.x"
        :x2="handlePoint.x"
        :y1="handlePoint.y"
        :y2="height - margin.bottom"
      />
      <circle class="curve-anchor" :cx="startPoint.x" :cy="startPoint.y" r="6" />
      <circle class="curve-anchor" :cx="peakPoint.x" :cy="peakPoint.y" r="6" />
      <circle
        class="curve-handle control"
        :cx="handlePoint.x"
        :cy="handlePoint.y"
        r="8"
        @pointerdown.prevent="startDrag($event)"
      />
      <circle
        class="curve-current"
        :cx="currentPoint.x"
        :cy="currentPoint.y"
        r="5"
      />
      <text class="curve-text" :x="margin.left" :y="height - 10">0%</text>
      <text class="curve-text" :x="width - margin.right - 20" :y="height - 10">Mid</text>
      <text class="curve-text" :x="6" :y="margin.top + 4">Near</text>
      <text class="curve-text" :x="12" :y="height - margin.bottom">Far</text>
    </svg>
    <div class="curve-note">
      The graph shows the first half of the move. The second half mirrors it automatically.
    </div>
  </div>
</template>
