# Glidemap Code Review

**Date:** 2026-08-01
**Scope:** full repo (~17.5k lines TS/Vue)
**Method:** 9 dimension reviewers → dedup → 2 independent adversarial refuters per finding → completeness critic (46 agents, ~2.1M tokens). Baseline: **142/142 tests pass**, `tsc --build` clean.

**Result: 18 confirmed findings** (4 high, 14 medium) + 1 new finding from the completeness critic, plus ~24 lower-severity items that weren't adversarially verified. One finding was refuted and dropped.

This is a well-engineered codebase with unusually good test coverage and security posture for its size — the findings below are mostly about *unbounded growth, crash-recovery, and observability*, not foot-guns in the happy path.

---

## 🔴 High severity

### 1. Persisted queued render jobs always fail on restart
**`server/index.ts:220`**, **`lib/render/queue.ts:141`** · category: correctness

`createRenderQueue()` is called at module top-level and `pump()`s synchronously if any persisted job is `queued`. But the worker eagerly evaluates `renderBaseUrl: getRenderBaseUrl()`, which throws `"Render server is not ready yet"` because `renderOrigin` is still `null` (only set after `listen()` resolves, a macrotask later). Every queued job surviving a crash (`SIGKILL` mid-run) is silently marked `failed` on the next boot and never rendered — both verifiers reproduced this.

**Fix:** start the pump only after `renderOrigin` is set (e.g. `main()` signals readiness), or make the worker tolerate a not-ready origin.

### 2. Render queue retains every job forever
**`lib/render/queue.ts:166`** · category: resource-exhaustion

The `jobs` array is never pruned (`unshift`/`push` are the only mutations), so completed/failed/cancelled jobs — each holding its full `payload.route` with coordinates — accumulate for the process lifetime *and* across restarts via `.queue-state.json`. Every progress frame (≈240/job) triggers an O(n) `JSON.stringify(jobs)` on a 250 ms debounce plus a full re-serialization to every SSE client. Memory, disk, and per-event CPU grow monotonically with uptime.

**Fix:** cap retained terminal jobs (keep last N), persist/broadcast only active + recent.

### 3. Upstream OSM/OSRM fetch has no timeout and ignores the abort signal
**`lib/providers/osm.ts:84`** · category: reliability

`await fetch(url, { headers })` passes no `signal` and no timeout — only the curl fallback has `--max-time 20`, and it's only reached when fetch *throws*. A silently-hung upstream never rejects, so the retry loop never advances and `queue.cancel()`/shutdown can't interrupt the serial render worker.

Caveat: Node/undici's 5-min default `headersTimeout`/`bodyTimeout` bounds the wedge to ~5 min/attempt unless the server trickles bytes — the core defect stands: cancel is ignored, the queue is blocked, and search/preview hang. Contrast `lib/tile-cache.ts:249`, which uses `AbortSignal.timeout(FETCH_TIMEOUT_MS)` correctly.

**Fix:** `AbortSignal.any([AbortSignal.timeout(ms), callerSignal])`, and thread the job signal through `prepareRoute` → provider calls.

### 4. Non-abort render failures leak the ffmpeg process
**`lib/render/video.ts:232`** · category: resource-leak

The `finally` block kills ffmpeg **only when `signal.aborted`**. A mid-capture failure (e.g. `page.evaluate`/`page.screenshot` throws after the spawn) skips both the kill and `ffmpegStdin.end()`, so the ffmpeg child blocks forever on its open stdin holding `output/<uuid>.mp4` open. The job is marked `failed` but the orphan accumulates on a long-running server.

Note: one verifier's sub-example (`waitForStyleLoad`) was corrected — it fires before the spawn, so the confirmed trigger is post-spawn `renderFrame`/screenshot throws.

**Fix:** always terminate ffmpeg (or end stdin / fail-safe timer) in `finally` regardless of abort state; add a render-failure test.

---

## 🟠 Medium severity

### 5. Optional auth doesn't protect render assets
**`server/index.ts:643`** · category: access-control

Bearer auth (`MAPANIM_API_SECRET`) only guards the `/api/` branch; `/output/` videos, `/node_modules/`, and `/tiles/` are served to anyone without a token. With the default docker-compose (no `MAPANIM_API_SECRET`), `/api/render-jobs` also returns every job's `outputUrl`, making all rendered videos enumerable.

### 6. `/api/preview` bypasses the stricter search rate limit
**`server/index.ts:619`** · category: rate-limit

`/api/preview` uses the general 240/min limiter even though each request fires 2 geocodes + 1 OSRM route (routing is never cached) — up to ~720 upstream calls/min/IP, ~8× the `/api/search` cap.

### 7. Unauthenticated, unrate-limited `/tiles/` proxies upstream
**`lib/render/asset-handler.ts:138`** · category: resource-exhaustion

Arbitrary `z/x/y` coordinates drive 3-attempt, 15 s-timeout upstream fetches + disk writes with no per-IP throttle. Attacker-varied coords bypass the inflight-map dedup.

### 8. "Invert easing" makes the camera travel backward mid-animation
**`web/renderer.ts:176`** (+ `web/renderer.js`, `TimingCurveEditor.vue`) · category: correctness

`eased = 2t − easeInOutCubic(t)` is non-monotonic (rises to 0.544, falls to 0.456), so `pathProgress` reverses ~57%→43% of the route — visible in both the preview and the rendered MP4 at `timingCurve ~100 + inverted`.

**Fix:** monotonic mirror `eased = t + (t − cubic)`, in all three copies.

### 9. Avatar uploads 2 MB but the server body limit is 1 MB
**`webapp/src/App.vue:243`** · category: correctness

Base64 expansion means avatars above ~768 KB always 413 on Queue/Save, with no explanation.

**Fix:** align the limits (account for base64) and surface a specific 413 message.

### 10. Metrics day-rollover drops the first new-day counts
**`lib/metrics.ts:142`** · category: concurrency

`loadDay` reassigns `buckets` after an `await`, wiping increments that landed during the read. Same race at startup (`:101`). A generation counter fixes all four metrics races (see themes).

### 11. docker-compose bind-mounts neutralize the image's node-user ownership
**`docker-compose.yml:17`** · category: deployment

Host `./output`, `./.tile-cache`, `./presets` are daemon-created as `root:root`, so the uid-1000 container can't write → every render/tile/preset write EACCES while `/api/health` stays green.

**Fix:** named volumes or a chown entrypoint.

### 12. Chromium launched without `--no-sandbox` as non-root
**`lib/render/video.ts:29`** · category: deployment

On hosts blocking unprivileged userns, the first render fails while health stays green (browser is launched lazily).

**Fix:** `chromium.launch({ args: ['--no-sandbox'] })` or a seccomp profile; add a readiness signal that exercises the browser.

### 13. Forgejo has no pre-merge CI gate
**`.forgejo/workflows/docker.yml:24`** · category: CI/CD

Only `on: push: [main]`; the PR-triggered `ci.yml` lives in `.github/workflows`, which Forgejo ignores while `.forgejo/workflows` exists. Regressions are only caught post-merge when the Docker build runs tests.

### 14. Logger drops `Error.prototype.cause`
**`lib/logger.ts:53`** · category: observability

The deliberate `cause` attached to `UpstreamError` (DNS/TLS/timeout detail) is unrecoverable from logs, so an operator can't distinguish a config error from an outage.

### 15. Render failures are never logged
**`lib/render/queue.ts:130`** · category: observability

The queue has no logger; a failing batch emits zero error-level lines, and page errors go to raw `console.error` without job context — a corrupt render can complete "successfully".

### 16. Corrupt metrics day-file silently wipes the day's stats
**`lib/metrics.ts:121`** + non-atomic `writeJson` (`lib/utils.ts:74`) · category: observability

### 17. Render-job lifecycle and `queue.cancel` untested
**`server/index.ts:437`** · category: test-coverage

No test enqueues/cancels/subscribes to SSE; `cancel()` on a queued job also **leaks its AbortController** (`queue.ts:172` never `controllers.delete`s), so the leak is real even though nothing tests it.

---

## 🟡 Additional (completeness critic, verified)

### 18. Corrupt preset file 500s the entire `GET /api/presets`
**`lib/presets/store.ts:76`** · category: error-handling

`listFilePresets` has no per-file try/catch; one truncated `.json` rejects the whole list. Same non-atomic-write root cause as #16.

---

## Lower-severity, not adversarially verified

Worth knowing, treated as less certain:

- Malformed percent-encoding returns 500 instead of 400 (`%zz` ids) — `server/index.ts:354,383`
- Client-caused `prepareRoute` errors (missing location, `mode: 'teleport'`) surface as 500 with masked messages instead of 400 — `lib/routes.ts:211`
- `MAX_QUEUE_DEPTH` is a check-then-act TOCTOU across an `await` — `server/index.ts:373`
- SSE has unbounded concurrent connections and ignores `write()` backpressure — `server/index.ts:201,404`
- Stale preview/search responses can overwrite newer UI state (version not bumped on the early-return path) — `webapp/src/App.vue:732,750`
- `/render/` accepts `postMessage` commands from any origin (validates only `namespace`) — `web/renderer.ts:1055`
- `visitorIps` Set grows unbounded per bucket — `lib/metrics.ts:167`
- 4×-duplicated camera defaults/easing math with an already-drifted aggressiveness range (editor clamps 0.98, renderer 1.0)
- Dead exports in `lib/routes.ts` (`deriveOverviewZoom`, `buildOutputPath`)
- `build:server` missing from the CI gate
- `chown -R /app` bloats the Docker layer
- Metrics `flush()` resets `dirty` after an await, losing records made during the write — `lib/metrics.ts:153`

---

## Cross-cutting themes

1. **Unbounded growth** — queue history, SSE clients/backpressure, `visitorIps`, `/tiles/` fan-out: cap retained state and honor `write()` backpressure.
2. **Crash-unsafe persistence** — non-atomic `writeJson` underpins #16 and #18; the restart failure (#1) is the same "state survives a crash but is mishandled" family. A temp-file + `fs.rename` utility would fix the whole class.
3. **Metrics concurrency** — four separate races (#10, startup, flush `dirty`-reset, unhandled flush rejection) all collapse into one fix: a generation counter guarding bucket assignment.
4. **Auth-off-by-default + assets bypass auth** — auth and rate limiting only exist inside the `/api/` branch; everything served by the asset handler is open.
5. **Client errors classified as 500** — plain `Error` throws from `prepareRoute`/`resolveLocation`/`decodeURIComponent` need a typed 4xx.
6. **Copy-pasted camera math** — the inverted-easing bug (#8) and the aggressiveness drift exist *because* the same formula lives in three files. A single shared module prevents the class.
7. **Render path under-tested** — `video.ts`, `tile-cache.ts`, job lifecycle have zero coverage despite the strong suite elsewhere.

---

## Suggested priority

1. #1 (restart recovery) and #2 (unbounded queue) — production crash/uptime correctness.
2. #3, #4 — render reliability (hang + process/file leak).
3. #5, #6, #7 — anything serving assets/upstream without auth or a tighter rate limit.
4. #8, #9 — user-visible correctness.
5. #16/#18 + atomic-write utility — silent data loss.

---

*Review method: 9 dimension reviewers (backend correctness, security, concurrency, frontend/MapLibre, performance, test coverage, CI/CD, observability, code quality) → dedup (49→43) → 2 adversarial refuters per top-18 finding → completeness critic. 46 agents, 0 errors. Baseline verified before review: `npm test` 142/142, `npm run typecheck` clean.*
