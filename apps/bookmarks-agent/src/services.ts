import type { BookmarkRepository } from './domain/ports/bookmarkRepository.js';
import { FirestoreBookmarkRepository } from './infra/firestore/firestoreBookmarkRepository.js';

export interface ServiceContainer {
  bookmarkRepository: BookmarkRepository;
}

export interface ServiceConfig {
  gcpProjectId: string;
}

let container: ServiceContainer | null = null;

export function initServices(_config: ServiceConfig): void {
  container = {
    bookmarkRepository: new FirestoreBookmarkRepository(),
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
