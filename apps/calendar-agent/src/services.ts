/**
 * Service container for calendar-agent.
 */

import type { GoogleCalendarClient, UserServiceClient } from './domain/index.js';
import { GoogleCalendarClientImpl } from './infra/google/googleCalendarClient.js';
import { UserServiceClientImpl } from './infra/user/userServiceClient.js';

export interface ServiceContainer {
  googleCalendarClient: GoogleCalendarClient;
  userServiceClient: UserServiceClient;
}

export interface ServiceConfig {
  userServiceUrl: string;
  internalAuthToken: string;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  container = {
    googleCalendarClient: new GoogleCalendarClientImpl(),
    userServiceClient: new UserServiceClientImpl(config.userServiceUrl, config.internalAuthToken),
  };
}

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(s: ServiceContainer): void {
  container = s;
}

export function resetServices(): void {
  container = null;
}
