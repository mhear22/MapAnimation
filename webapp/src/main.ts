import { createApp } from "vue";
import App from "./App.vue";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { ensureTileCacheReady } from "./tile-cache.js";

void ensureTileCacheReady();
createApp(App).mount("#app");
