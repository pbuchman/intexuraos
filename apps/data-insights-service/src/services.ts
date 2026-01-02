/**
 * Service wiring for data-insights-service.
 * Provides dependency injection for domain adapters.
 */
import type {
  AnalyticsEventRepository,
  AggregatedInsightsRepository,
} from './domain/insights/index.js';
import { FirestoreAnalyticsEventRepository } from './infra/firestore/analyticsEventRepository.js';
import { FirestoreAggregatedInsightsRepository } from './infra/firestore/aggregatedInsightsRepository.js';

/**
 * Service container holding all adapter instances.
 */
export interface ServiceContainer {
  analyticsEventRepository: AnalyticsEventRepository;
  aggregatedInsightsRepository: AggregatedInsightsRepository;
}

let container: ServiceContainer | null = null;

/**
 * Get or create the service container.
 */
export function getServices(): ServiceContainer {
  container ??= {
    analyticsEventRepository: new FirestoreAnalyticsEventRepository(),
    aggregatedInsightsRepository: new FirestoreAggregatedInsightsRepository(),
  };
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
