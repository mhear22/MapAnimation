let registrationPromise: Promise<void> | null = null;

export async function ensureTileCacheReady(): Promise<void> {
  if (registrationPromise) {
    return registrationPromise;
  }

  registrationPromise = (async () => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      return;
    }

    await navigator.serviceWorker.register("/tile-cache-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  })().catch((error: unknown) => {
    console.warn("Tile cache service worker registration failed", error);
  });

  return registrationPromise;
}
