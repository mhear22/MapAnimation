const { maplibregl } = window;

const state = {
  map: null,
  scene: null,
  markers: [],
  cameras: null,
  mapType: null,
  lastProgress: 0
};

function buildBaseStyle(mapType = "satellite") {
  if (mapType === "standard") {
    return {
      version: 8,
      sources: {
        carto: {
          type: "raster",
          tiles: [
            "/tiles/standard/{z}/{x}/{y}"
          ],
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
  }

  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "/tiles/satellite/{z}/{x}/{y}"
        ],
        tileSize: 256,
        attribution: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
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
}

async function addRouteLayers() {
  state.map.addSource("route", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: []
    }
  });

  state.map.addLayer({
    id: "route-shadow",
    type: "line",
    source: "route",
    filter: ["==", "$type", "LineString"],
    paint: {
      "line-color": "rgba(9, 35, 58, 0.25)",
      "line-width": 14,
      "line-blur": 1
    }
  });

  state.map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    filter: ["==", "$type", "LineString"],
    paint: {
      "line-color": "#0f9f8f",
      "line-width": 8
    }
  });

  state.map.addLayer({
    id: "route-points",
    type: "circle",
    source: "route",
    filter: ["==", "$type", "Point"],
    paint: {
      "circle-radius": 8,
      "circle-color": [
        "match",
        ["get", "kind"],
        "end",
        "#0f9f8f",
        "#152634"
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3
    }
  });
}

function createMarker(label, className) {
  const element = document.createElement("div");
  element.className = `route-label ${className}`.trim();
  element.textContent = label;
  return element;
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function sampleTimingEasing(t, intensity, inverted) {
  const linear = t;
  const cubic = easeInOutCubic(t);
  const sign = inverted ? -1 : 1;
  return linear + (cubic - linear) * clamp(intensity, 0, 1) * sign;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

function haversineKilometers(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const lat1 = a[1] * rad;
  const lat2 = b[1] * rad;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function buildLineFeature(scene) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: scene.path?.coordinates?.length ? scene.path.coordinates : [scene.from.coords, scene.to.coords]
    },
    properties: {}
  };
}

function buildPointFeature(location, kind) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: location.coords
    },
    properties: {
      kind
    }
  };
}

function computeBounds(coordinates) {
  const bounds = new maplibregl.LngLatBounds(coordinates[0], coordinates[0]);
  for (const coordinate of coordinates.slice(1)) {
    bounds.extend(coordinate);
  }
  return bounds;
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function toAggressivenessControl(aggressiveness = 50) {
  return lerp(0.02, 1.0, clamp(aggressiveness, 0, 100) / 100);
}

function sampleMirroredBlend(progress, aggressiveness = 50) {
  const t = clamp(progress, 0, 1);
  const control = toAggressivenessControl(aggressiveness);
  return 2 * (1 - t) * t * control + t * t;
}

function normalizeWindowRadius(value) {
  return Math.max(1, Math.round(value));
}

function buildPathSampler(coordinates) {
  if (!coordinates?.length) {
    return {
      coordinates: [],
      cumulative: [0],
      total: 0
    };
  }

  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    const segmentLength = haversineKilometers(coordinates[index - 1], coordinates[index]);
    cumulative.push(cumulative[index - 1] + segmentLength);
  }

  return {
    coordinates,
    cumulative,
    total: cumulative[cumulative.length - 1]
  };
}

function smoothCoordinates(coordinates, passes = 1, radius = 2) {
  if (!coordinates?.length || coordinates.length < 3) {
    return coordinates;
  }

  const smoothed = coordinates.map((coordinate) => [...coordinate]);
  const windowRadius = normalizeWindowRadius(radius);

  for (let pass = 0; pass < passes; pass += 1) {
    const next = smoothed.map((coordinate) => [...coordinate]);
    for (let index = 1; index < smoothed.length - 1; index += 1) {
      let lngSum = 0;
      let latSum = 0;
      let weightSum = 0;

      for (
        let neighbor = Math.max(0, index - windowRadius);
        neighbor <= Math.min(smoothed.length - 1, index + windowRadius);
        neighbor += 1
      ) {
        const distanceFromCenter = Math.abs(neighbor - index);
        const weight = windowRadius + 1 - distanceFromCenter;
        lngSum += smoothed[neighbor][0] * weight;
        latSum += smoothed[neighbor][1] * weight;
        weightSum += weight;
      }

      next[index] = [lngSum / weightSum, latSum / weightSum];
    }

    next[0] = [...coordinates[0]];
    next[next.length - 1] = [...coordinates[coordinates.length - 1]];

    for (let index = 0; index < smoothed.length; index += 1) {
      smoothed[index] = next[index];
    }
  }

  return smoothed;
}

function buildCameraPathSampler(coordinates, smoothing = 0.9) {
  const routePath = buildPathSampler(coordinates);
  if (routePath.coordinates.length < 3 || routePath.total === 0) {
    return routePath;
  }

  const normalizedSmoothing = clamp(smoothing, 0, 1);
  const sampleCount = Math.round(clamp(24 + routePath.total * 4, 32, 120));
  const resampled = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const progress = sampleCount === 1 ? 1 : index / (sampleCount - 1);
    resampled.push(samplePath(routePath, progress));
  }

  const passes = Math.round(lerp(1, 10, normalizedSmoothing));
  const radius = lerp(1, 5, normalizedSmoothing);
  return buildPathSampler(smoothCoordinates(resampled, passes, radius));
}

function samplePath(path, progress) {
  if (!path.coordinates.length) {
    return [0, 0];
  }

  if (path.coordinates.length === 1 || path.total === 0) {
    return path.coordinates[0];
  }

  const target = path.total * clamp(progress, 0, 1);

  for (let index = 1; index < path.cumulative.length; index += 1) {
    if (target <= path.cumulative[index]) {
      const segmentStart = path.cumulative[index - 1];
      const segmentLength = path.cumulative[index] - segmentStart || 1;
      const segmentProgress = (target - segmentStart) / segmentLength;
      return lerpPoint(path.coordinates[index - 1], path.coordinates[index], segmentProgress);
    }
  }

  return path.coordinates[path.coordinates.length - 1];
}

function once(eventName) {
  return new Promise((resolve) => {
    state.map.once(eventName, resolve);
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function waitForIdle(timeoutMs = 2500) {
  if (state.map.loaded() && state.map.areTilesLoaded()) {
    await sleep(120);
    return;
  }

  await Promise.race([once("idle"), sleep(timeoutMs)]);
  await sleep(120);
}

async function setupMap() {
  if (state.map) {
    return;
  }

  state.map = new maplibregl.Map({
    container: "map",
    style: buildBaseStyle("satellite"),
    center: [144.9631, -37.8136],
    zoom: 13,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pitch: 0,
    bearing: 0,
    preserveDrawingBuffer: true
  });

  await once("load");
  await addRouteLayers();
  state.mapType = "satellite";

  await waitForIdle();
}

function removeMarkers() {
  for (const marker of state.markers) {
    marker.remove();
  }

  state.markers = [];
}

async function setScene(scene) {
  await setupMap();
  const targetMapType = scene.mapType ?? "satellite";
  if (targetMapType !== state.mapType) {
    state.map.setStyle(buildBaseStyle(targetMapType));
    await once("styledata");
    await addRouteLayers();
    state.mapType = targetMapType;
  }
  state.map.resize();
  removeMarkers();
  state.scene = scene;

  const routeSource = state.map.getSource("route");
  routeSource.setData({
    type: "FeatureCollection",
    features: [
      buildLineFeature(scene),
      buildPointFeature(scene.from, "start"),
      buildPointFeature(scene.to, "end")
    ]
  });

  const camera = scene.camera ?? {};
  const startZoom = camera.startZoom ?? scene.startZoom ?? 15.8;
  const endZoom = camera.endZoom ?? scene.endZoom ?? startZoom;
  const routeCoordinates =
    scene.path?.coordinates?.length >= 2 ? scene.path.coordinates : [scene.from.coords, scene.to.coords];
  const bounds = computeBounds(routeCoordinates);
  const canvas = state.map.getCanvas();
  const maxPadding = Math.max(24, Math.floor(Math.min(canvas.width || 0, canvas.height || 0) / 4) || 24);
  const paddingValue = Math.min(scene.overviewPadding ?? 180, maxPadding);
  const overviewCamera = state.map.cameraForBounds(bounds, {
    padding: {
      top: paddingValue,
      right: paddingValue + 40,
      bottom: paddingValue,
      left: paddingValue + 40
    },
    maxZoom: Math.max(startZoom, endZoom) - 0.8
  });
  const closerZoom = Math.max(startZoom, endZoom);
  const requiredZoomOut = Math.max(0, closerZoom - (overviewCamera?.zoom ?? startZoom - 1.6));
  const maxAltitude = clamp(camera.maxAltitude ?? (camera.peakAltitude != null ? 50 + camera.peakAltitude : 100), 50, 150);

  state.cameras = {
    start: {
      center: scene.from.coords,
      zoom: startZoom
    },
    overview: {
      center: overviewCamera?.center?.toArray?.() ?? midpoint(scene.from.coords, scene.to.coords),
      zoom: Math.max(2.2, closerZoom - requiredZoomOut * (maxAltitude / 100))
    },
    end: {
      center: scene.to.coords,
      zoom: endZoom
    },
    routePath: buildPathSampler(routeCoordinates),
    cameraPath: buildCameraPathSampler(routeCoordinates, camera.smoothing ?? scene.cameraSmoothing ?? 0.92),
    aggressiveness: clamp(camera.aggressiveness ?? camera.curvePosition ?? 50, 0, 100),
    timingCurve: clamp(camera.timingCurve ?? 50, 0, 100),
    timingInverted: Boolean(camera.timingInverted)
  };

  state.markers.push(
    new maplibregl.Marker({
      element: createMarker(scene.from.label, "start"),
      anchor: "bottom-left",
      offset: [12, -18]
    })
      .setLngLat(scene.from.coords)
      .addTo(state.map)
  );

  state.markers.push(
    new maplibregl.Marker({
      element: createMarker(scene.to.label, "end"),
      anchor: "bottom-left",
      offset: [12, -18]
    })
      .setLngLat(scene.to.coords)
      .addTo(state.map)
  );

  state.map.jumpTo({
    center: scene.from.coords,
    zoom: startZoom,
    bearing: 0,
    pitch: 0
  });

  await waitForIdle();
}

async function primeTiles() {
  for (const camera of [state.cameras.overview, state.cameras.start, state.cameras.end]) {
    state.map.jumpTo({
      center: camera.center,
      zoom: camera.zoom,
      bearing: 0,
      pitch: 0
    });
    await waitForIdle();
  }
}

async function renderFrame(progress) {
  const holdIn = 0.08;
  const holdOut = 0.08;
  const mapped = clamp((progress - holdIn) / (1 - holdIn - holdOut), 0, 1);
  const eased = sampleTimingEasing(mapped, (state.cameras.timingCurve ?? 50) / 100, state.cameras.timingInverted);

  const pathCenter = samplePath(state.cameras.cameraPath, eased);

  const halfProgress = mapped <= 0.5 ? mapped / 0.5 : (mapped - 0.5) / 0.5;
  const zoomBlend = sampleMirroredBlend(halfProgress, state.cameras.aggressiveness);
  const zoomValue =
    mapped <= 0.5
      ? lerp(state.cameras.start.zoom, state.cameras.overview.zoom, zoomBlend)
      : lerp(state.cameras.overview.zoom, state.cameras.end.zoom, zoomBlend);

  state.map.jumpTo({
    center: pathCenter,
    zoom: zoomValue,
    bearing: 0,
    pitch: 0
  });

  await sleep(16);
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  state.lastProgress = progress;
}

const rendererApi = {
  setScene,
  primeTiles,
  renderFrame
};

async function handleMessage(event) {
  const payload = event.data;
  if (!payload || payload.namespace !== "mapanim") {
    return;
  }

  const { requestId, type } = payload;

  try {
    switch (type) {
      case "set-scene":
        await rendererApi.setScene(payload.scene);
        break;
      case "prime-tiles":
        await rendererApi.primeTiles();
        break;
      case "render-frame":
        await rendererApi.renderFrame(payload.progress ?? state.lastProgress ?? 0);
        break;
      default:
        throw new Error(`Unknown renderer command "${type}"`);
    }

    event.source?.postMessage(
      {
        namespace: "mapanim",
        type: "command-complete",
        requestId
      },
      event.origin || "*"
    );
  } catch (error) {
    event.source?.postMessage(
      {
        namespace: "mapanim",
        type: "command-error",
        requestId,
        message: error.message
      },
      event.origin || "*"
    );
  }
}

window.addEventListener("message", (event) => {
  void handleMessage(event);
});

window.__MAP_RENDERER__ = rendererApi;
window.__MAP_RENDERER_READY__ = true;

if (window.parent && window.parent !== window) {
  window.parent.postMessage(
    {
      namespace: "mapanim",
      type: "ready"
    },
    "*"
  );
}
