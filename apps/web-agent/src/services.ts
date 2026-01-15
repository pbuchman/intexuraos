import pino from 'pino';
import { getLogLevel } from '@intexuraos/common-core';
import type { LinkPreviewFetcherPort } from './domain/index.js';
import { OpenGraphFetcher } from './infra/index.js';

export interface ServiceContainer {
  linkPreviewFetcher: LinkPreviewFetcherPort;
}

let container: ServiceContainer | undefined;

export function initServices(): void {
  container = {
    linkPreviewFetcher: new OpenGraphFetcher(
      {},
      pino({ name: 'openGraphFetcher', level: getLogLevel() })
    ),
  };
}

export function getServices(): ServiceContainer {
  if (container === undefined) {
    throw new Error('Services not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = undefined;
}
