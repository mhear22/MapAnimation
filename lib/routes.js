import path from "node:path";
import { clamp, readJson, slugify } from "./utils.js";
import { createProviderRegistry } from "./providers/index.js";
import { mapTravelModeToProfile } from "./providers/osm.js";

export function mergeRoute(defaults, route) {
  return {
    ...defaults,
    ...route,
    start: {
      ...(defaults.start ?? defaults.from),
      ...(route.start ?? route.from)
    },
    end: {
      ...(defaults.end ?? defaults.to),
      ...(route.end ?? route.to)
    },
    camera: {
      ...(defaults.camera ?? {}),
      ...(route.camera ?? {})
    }
  };
}

export async function loadRoutes(args, { rootDir }) {
  if (args.config) {
    const configPath = path.resolve(rootDir, args.config);
    const parsed = await readJson(configPath);
    const routes = parsed.routes.map((route) => mergeRoute(parsed.defaults ?? {}, route));
    if (!args.id) {
      return routes;
    }

    const matchedRoute = routes.find((route) => route.id === args.id);
    if (!matchedRoute) {
      throw new Error(`No route found for --id ${args.id}`);
    }

    return [matchedRoute];
  }

  if (!args.from || !args.to) {
    throw new Error("Provide either --config <file> or both --from and --to");
  }

  return [
    {
      id: slugify(`${args.from}-to-${args.to}`),
      width: Number(args.width ?? 1920),
      height: Number(args.height ?? 1080),
      fps: Number(args.fps ?? 30),
      durationSeconds: Number(args.duration ?? 8),
      overviewPadding: Number(args.overviewPadding ?? 180),
      mapType: args.mapType ?? "satellite",
      mode: args.mode ?? args.travelMode ?? "walking",
      start: {
        label: args.from,
        query: args.from
      },
      end: {
        label: args.to,
        query: args.to
      },
      camera: {
        startZoom: Number(args.startZoom ?? 15.8),
        endZoom: Number(args.endZoom ?? 15.8),
        maxAltitude: Number(args.maxAltitude ?? (args.peakAltitude != null ? 50 + Number(args.peakAltitude) : 100)),
        aggressiveness: Number(args.aggressiveness ?? args.curvePosition ?? 50),
        smoothing: Number(args.cameraSmoothing ?? 0.92)
      },
      output: args.out ?? `output/${slugify(`${args.from}-to-${args.to}`)}.mp4`
    }
  ];
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function haversineKilometers(a, b) {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b[0] - a[0]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function lngLatToVector([lng, lat]) {
  const lngRad = toRadians(lng);
  const latRad = toRadians(lat);
  const cosLat = Math.cos(latRad);
  return [
    cosLat * Math.cos(lngRad),
    cosLat * Math.sin(lngRad),
    Math.sin(latRad)
  ];
}

function vectorToLngLat([x, y, z]) {
  const hyp = Math.hypot(x, y);
  return [toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, hyp))];
}

function normalizeVector([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function dotProduct(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function slerpPoint(fromCoords, toCoords, t) {
  const start = lngLatToVector(fromCoords);
  const end = lngLatToVector(toCoords);
  const omega = Math.acos(Math.min(1, Math.max(-1, dotProduct(start, end))));

  if (omega === 0) {
    return fromCoords;
  }

  const sinOmega = Math.sin(omega);
  const startWeight = Math.sin((1 - t) * omega) / sinOmega;
  const endWeight = Math.sin(t * omega) / sinOmega;
  const interpolated = normalizeVector([
    start[0] * startWeight + end[0] * endWeight,
    start[1] * startWeight + end[1] * endWeight,
    start[2] * startWeight + end[2] * endWeight
  ]);

  return vectorToLngLat(interpolated);
}

export function buildFlightPath(fromCoords, toCoords) {
  const distanceKm = haversineKilometers(fromCoords, toCoords);
  const pointCount = Math.round(Math.max(48, Math.min(220, distanceKm / 6)));
  const coordinates = [];

  for (let index = 0; index < pointCount; index += 1) {
    const progress = pointCount === 1 ? 1 : index / (pointCount - 1);
    const point = slerpPoint(fromCoords, toCoords, progress);
    const arcLift = Math.sin(progress * Math.PI) * Math.min(2.4, distanceKm / 1200);
    coordinates.push([point[0], point[1] + arcLift]);
  }

  coordinates[0] = fromCoords;
  coordinates[coordinates.length - 1] = toCoords;

  return {
    coordinates,
    distanceMeters: Math.round(distanceKm * 1000),
    durationSeconds: null,
    profile: "flight"
  };
}

export async function resolveLocation(location, { providerRegistry, providerName }) {
  if (Array.isArray(location?.coords) && location.coords.length === 2) {
    return {
      ...location,
      label: location.label ?? location.query ?? "",
      coords: [Number(location.coords[0]), Number(location.coords[1])]
    };
  }

  if (!location?.query) {
    throw new Error(`Location "${location?.label ?? "unknown"}" needs either coords or a query`);
  }

  const provider = providerRegistry.getProvider(providerName);
  const result = await provider.geocode(location.query);
  return {
    ...result,
    ...location,
    label: location.label || result.label || location.query,
    query: location.query ?? result.query,
    coords: result.coords
  };
}

export function normalizeCamera(camera = {}, route = {}) {
  const startZoom = Number(camera.startZoom ?? route.startZoom ?? 15.8);
  const endZoom = Number(camera.endZoom ?? route.endZoom ?? startZoom);
  const legacyPeakAltitude = camera.peakAltitude ?? route.peakAltitude;
  const maxAltitude = clamp(Number(camera.maxAltitude ?? (legacyPeakAltitude != null ? 50 + Number(legacyPeakAltitude) : 100)), 50, 150);
  const aggressiveness = clamp(Number(camera.aggressiveness ?? camera.curvePosition ?? route.curvePosition ?? 50), 0, 100);
  const smoothing = clamp(Number(camera.smoothing ?? route.cameraSmoothing ?? 0.92), 0, 1);

  return {
    startZoom,
    endZoom,
    maxAltitude,
    aggressiveness,
    smoothing
  };
}

export function deriveOverviewZoom(baseOverviewZoom, route) {
  const camera = normalizeCamera(route.camera, route);
  const closerZoom = Math.max(camera.startZoom, camera.endZoom);
  const requiredZoomOut = Math.max(0, closerZoom - baseOverviewZoom);
  return Math.max(2.2, closerZoom - requiredZoomOut * (camera.maxAltitude / 100));
}

export async function prepareRoute(route, options = {}) {
  const providerRegistry = options.providerRegistry ?? createProviderRegistry();
  const providerName = route.provider ?? providerRegistry.defaultProvider;
  const startLocation = route.start ?? route.from;
  const endLocation = route.end ?? route.to;
  const from = await resolveLocation(startLocation, { providerRegistry, providerName });
  const to = await resolveLocation(endLocation, { providerRegistry, providerName });
  const travelMode = route.mode ?? route.travelMode ?? "walking";
  const mapType = route.mapType ?? "satellite";
  const routedPath =
    Array.isArray(route.path?.coordinates) && route.path.coordinates.length >= 2
      ? {
          coordinates: route.path.coordinates,
          distanceMeters: route.path.distanceMeters ?? null,
          durationSeconds: route.path.durationSeconds ?? null,
          profile: route.path.profile ?? mapTravelModeToProfile(travelMode)
        }
      : travelMode === "flying" || travelMode === "flight"
        ? buildFlightPath(from.coords, to.coords)
        : await providerRegistry.getProvider(providerName).route({
            fromCoords: from.coords,
            toCoords: to.coords,
            mode: travelMode
          });

  const normalizedCamera = normalizeCamera(route.camera, route);

  return {
    ...route,
    id: route.id ?? slugify(`${from.label ?? startLocation.query}-to-${to.label ?? endLocation.query}`),
    provider: providerName,
    mode: travelMode,
    travelMode,
    mapType,
    camera: normalizedCamera,
    start: from,
    end: to,
    from,
    to,
    path: routedPath
  };
}

export function buildOutputPath(route) {
  if (route.output) {
    return route.output;
  }

  const startLabel = route.start?.label ?? route.from?.label ?? route.start?.query ?? "start";
  const endLabel = route.end?.label ?? route.to?.label ?? route.end?.query ?? "end";
  return `output/${slugify(`${startLabel}-to-${endLabel}`)}.mp4`;
}
