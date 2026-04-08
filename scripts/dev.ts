process.env["MAPANIM_DEV"] = "1";
process.env["PORT"] ??= "5173";

// Dev now runs as a single Node process: the app server owns port 5173
// and mounts Vite in middleware mode for frontend assets and HMR.
await import("../server/index.js");
