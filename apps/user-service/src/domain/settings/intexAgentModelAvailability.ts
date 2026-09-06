import type {
  IntexAgentCatalogEvidence,
  OpenRouterCatalogSnapshot,
} from '@intexuraos/infra-openrouter';

export interface IntexAgentCatalogEvidenceProvider {
  start(): Promise<OpenRouterCatalogSnapshot | null>;
  getIntexAgentCatalogEvidence(): Promise<IntexAgentCatalogEvidence | null>;
}

export interface IntexAgentModelAvailability {
  start(): Promise<void>;
  isAvailableForUser(userId: string): Promise<boolean>;
}

export interface IntexAgentModelAvailabilityConfig {
  userId: string | null;
  catalogClient: IntexAgentCatalogEvidenceProvider | null;
}

export function createIntexAgentModelAvailability(
  config: IntexAgentModelAvailabilityConfig
): IntexAgentModelAvailability {
  let started = false;

  return {
    async start(): Promise<void> {
      if (started || config.catalogClient === null) {
        return;
      }
      started = true;
      try {
        await config.catalogClient.start();
      } catch {
        // Catalog startup is fail-closed; requests may recover through the shared client.
      }
    },
    async isAvailableForUser(userId: string): Promise<boolean> {
      if (config.userId === null || userId !== config.userId || config.catalogClient === null) {
        return false;
      }
      try {
        return (await config.catalogClient.getIntexAgentCatalogEvidence()) !== null;
      } catch {
        return false;
      }
    },
  };
}
