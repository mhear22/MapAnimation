import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sleep } from "../utils.js";

const USER_AGENT = "MapAnim/0.2 (local webapp)";
const execFileAsync = promisify(execFile);

async function requestJsonViaCurl(url) {
  const { stdout } = await execFileAsync("curl", [
    "--silent",
    "--show-error",
    "--fail",
    "--location",
    "--max-time",
    "20",
    "--user-agent",
    USER_AGENT,
    "--header",
    "Accept-Language: en-AU",
    String(url)
  ]);
  return JSON.parse(stdout);
}

async function requestJson(url, { retries = 3 } = {}) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-AU"
        }
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;

      try {
        return await requestJsonViaCurl(url);
      } catch (curlError) {
        lastError = curlError;
      }

      if (attempt < retries - 1) {
        await sleep(450 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

export function createOsmProvider() {
  return {
    id: "osm",

    async search(query, { limit = 5 } = {}) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("q", query);

      const results = await requestJson(url);
      return Array.isArray(results)
        ? results.map((item, index) => ({
            id: `osm-${item.place_id ?? index}`,
            provider: "osm",
            label: item.display_name,
            query: item.display_name,
            coords: [Number(item.lon), Number(item.lat)],
            address: item.address ?? null
          }))
        : [];
    },

    async geocode(query) {
      const results = await this.search(query, { limit: 1 });
      if (!results.length) {
        throw new Error(`No geocoding result found for "${query}"`);
      }

      return results[0];
    },

    async route({ fromCoords, toCoords, mode }) {
      const profile = mapTravelModeToProfile(mode);
      const url = new URL(
        `https://router.project-osrm.org/route/v1/${profile}/${fromCoords[0]},${fromCoords[1]};${toCoords[0]},${toCoords[1]}`
      );
      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("steps", "false");

      const payload = await requestJson(url);
      if (payload.code !== "Ok" || !payload.routes?.[0]?.geometry?.coordinates?.length) {
        throw new Error(`Routing failed with code ${payload.code ?? "unknown"}`);
      }

      return {
        coordinates: payload.routes[0].geometry.coordinates,
        distanceMeters: payload.routes[0].distance,
        durationSeconds: payload.routes[0].duration,
        profile
      };
    }
  };
}

export function mapTravelModeToProfile(mode = "walking") {
  switch (mode) {
    case "walking":
    case "foot":
      return "foot";
    case "driving":
    case "car":
      return "driving";
    case "flying":
    case "flight":
      return "flight";
    case "public transport":
    case "public-transport":
    case "transit":
      throw new Error("Public transport requires route.path.coordinates because no built-in transit router is configured");
    default:
      throw new Error(`Unsupported travel mode "${mode}"`);
  }
}
