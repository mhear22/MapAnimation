import { createOsmProvider } from "./osm.js";
import type { Provider, ProviderRegistry } from "../../types/index.js";

export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<string, Provider>([["osm", createOsmProvider()]]);

  return {
    defaultProvider: "osm",
    getProvider(name: string = "osm"): Provider {
      const provider = providers.get(name);
      if (!provider) {
        throw new Error(`Unknown provider "${name}"`);
      }

      return provider;
    },
    listProviders(): string[] {
      return [...providers.keys()];
    }
  };
}
