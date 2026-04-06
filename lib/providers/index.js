import { createOsmProvider } from "./osm.js";

export function createProviderRegistry() {
  const providers = new Map([["osm", createOsmProvider()]]);

  return {
    defaultProvider: "osm",
    getProvider(name = "osm") {
      const provider = providers.get(name);
      if (!provider) {
        throw new Error(`Unknown provider "${name}"`);
      }

      return provider;
    },
    listProviders() {
      return [...providers.keys()];
    }
  };
}
