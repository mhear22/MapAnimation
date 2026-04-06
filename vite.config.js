import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  root: "webapp",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4822",
      "/render": "http://127.0.0.1:4822",
      "/output": "http://127.0.0.1:4822",
      "/node_modules/maplibre-gl": "http://127.0.0.1:4822"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
