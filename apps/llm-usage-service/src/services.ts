import type { UsageEventRepository } from './domain/repositories/usageEventRepository.js';
import type { UsageAggregateRepository } from './domain/repositories/usageAggregateRepository.js';
import type { PricingRepository } from './domain/repositories/pricingRepository.js';
import { FirestoreUsageEventRepository } from './infra/firestore/firestoreUsageEventRepository.js';
import { FirestoreUsageAggregateRepository } from './infra/firestore/firestoreUsageAggregateRepository.js';
import { FirestorePricingRepository } from './infra/firestore/firestorePricingRepository.js';

export interface ServiceContainer {
  usageEventRepository: UsageEventRepository;
  usageAggregateRepository: UsageAggregateRepository;
  pricingRepository: PricingRepository;
  orchestratorSecret: string;
}

let container: ServiceContainer | null = null;

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initializeServices() first.');
  }
  return container;
}

export function initializeServices(): void {
  const orchestratorSecret = process.env['INTEXURAOS_ORCHESTRATOR_SECRET'];
  if (orchestratorSecret === undefined || orchestratorSecret === '') {
    throw new Error('INTEXURAOS_ORCHESTRATOR_SECRET is required');
  }

  container = {
    usageEventRepository: new FirestoreUsageEventRepository(),
    usageAggregateRepository: new FirestoreUsageAggregateRepository(),
    pricingRepository: new FirestorePricingRepository(),
    orchestratorSecret,
  };
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}
