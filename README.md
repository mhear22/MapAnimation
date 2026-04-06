# MapAnim

Render map videos from a root-level route JSON, or use the local webapp to search locations, tune the camera curve, preview the route, save presets, and queue MP4 exports.

## Setup

```bash
npm install
npm run install:browsers
```

## Run The Webapp

```bash
npm run dev
```

This now runs as a single Node process at [http://127.0.0.1:5173](http://127.0.0.1:5173). The app server mounts Vite in middleware mode, so the frontend, API, render surface, and tiles all come from the same dev server.

If you want to run just the packaged local server, use:

```bash
npm run build:webapp
npm run dev:server
```

The app includes:

- place search backed by the default OSM provider
- live route preview via the existing MapLibre render surface
- a simplified half-curve editor for zoom aggressiveness plus exact controls for `startZoom`, `endZoom`, and `maxAltitude`
- exact numeric controls for `durationSeconds` and `smoothing`
- preset save/load from `presets/`
- sequential render queue with live progress updates

## Render Everything

```bash
./render-all.sh
```

This reads [routes.json](./routes.json) and writes every configured video to `output/`.

## Render a one-off route

```bash
npm run render:route -- \
  --from "Melbourne Convention and Exhibition Centre, South Wharf VIC 3006, Australia" \
  --to "Melbourne CBD VIC 3000, Australia" \
  --mapType satellite \
  --mode walking \
  --cameraSmoothing 0.92 \
  --out output/custom.mp4
```

## Route JSON

Each route supports:

- `start` / `end`: each accepts `label`, `query`, and optional `coords`
- `mapType`: `satellite` or `standard`
- `mode`: `walking`, `driving`, `flying`, or `public transport`
- `path.coordinates`: optional explicit routed line as `[[lng, lat], ...]`
- `output`: output video path
- `width`, `height`, `fps`, `durationSeconds`, `overviewPadding`
- optional `camera` object:

```json
{
  "camera": {
    "startZoom": 15.8,
    "endZoom": 15.8,
    "maxAltitude": 100,
    "aggressiveness": 50,
    "smoothing": 0.92
  }
}
```

The older top-level `startZoom`, `endZoom`, and `cameraSmoothing` fields still work for CLI compatibility.

`public transport` is accepted in the JSON schema, but you need to provide `path.coordinates` for it because this project does not have a built-in transit router.

`smoothing` affects only the camera path, not the displayed route line. Higher values produce a much calmer glide through bends.

`maxAltitude` is a percentage from `50` to `150`. `100` is the baseline that zooms out far enough to see both endpoints.

`aggressiveness` controls how quickly the move opens up from the start toward that midpoint framing. The second half mirrors the first.

`flying` generates a curved flight path automatically, which is useful for long airport-to-airport moves.

## Container

The repo now includes a root `Dockerfile` that works with Podman because it uses a standard OCI image layout. It installs Chromium for Playwright, `ffmpeg` for encoding, builds the Vue app, and starts the packaged server on port `5173`.

Build the image:

```bash
podman build -t mapanim .
```

Run it:

```bash
mkdir -p output presets

podman run --rm \
  --name mapanim \
  --ipc=host \
  -p 5173:5173 \
  -v "$(pwd)/output:/app/output:Z" \
  -v "$(pwd)/presets:/app/presets:Z" \
  -v "$(pwd)/routes.json:/app/routes.json:Z" \
  mapanim
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173).

Notes:

- `--ipc=host` is recommended for Chromium stability in containers.
- The `:Z` suffix is useful on SELinux-enabled Podman hosts.
- Mounting `output/`, `presets/`, and `routes.json` keeps your renders and local data outside the container image.
- If you still want the older split workflow, `npm run dev:webapp` can proxy to a separately started backend from `npm run dev:server` using `MAPANIM_API_PORT`.
