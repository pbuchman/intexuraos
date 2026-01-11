/**
 * Service wiring for data-insights-agent.
 * Provides dependency injection for domain adapters.
 */
import type { DataSourceRepository } from './domain/dataSource/index.js';
import type { TitleGenerationService } from './infra/gemini/titleGenerationService.js';
import type {
  CompositeFeedRepository,
  FeedNameGenerationService,
  MobileNotificationsClient,
} from './domain/compositeFeed/index.js';
import type { SnapshotRepository } from './domain/snapshot/index.js';
import type {
  VisualizationRepository,
  VisualizationGenerationService,
} from './domain/visualization/index.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  dataSourceRepository: DataSourceRepository;
  titleGenerationService: TitleGenerationService;
  compositeFeedRepository: CompositeFeedRepository;
  feedNameGenerationService: FeedNameGenerationService;
  mobileNotificationsClient: MobileNotificationsClient;
  snapshotRepository: SnapshotRepository;
  visualizationRepository: VisualizationRepository;
  visualizationGenerationService: VisualizationGenerationService;
}

let container: ServiceContainer | null = null;

/**
 * Initialize services. Call this early in server startup.
 */
export function initServices(services: ServiceContainer): void {
  container = services;
}

/**
 * Get the service container. Throws if initServices() wasn't called.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

/**
 * Set a custom service container (for testing).
 */
export function setServices(services: ServiceContainer): void {
  container = services;
}

/**
 * Reset the service container (for testing).
 */
export function resetServices(): void {
  container = null;
}
