import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const apiPort = process.env.MAPANIM_API_PORT ?? "4822";
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

export default defineConfig(() => ({
  plugins: [vue()],
  root: "webapp",
  server: process.env.MAPANIM_VITE_MIDDLEWARE === "1"
    ? {}
    : {
        proxy: {
          "/api": apiBaseUrl,
          "/render": apiBaseUrl,
          "/output": apiBaseUrl,
          "/node_modules/maplibre-gl": apiBaseUrl
        }
      },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
}));
