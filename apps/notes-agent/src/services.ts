import type { NoteRepository } from './domain/ports/noteRepository.js';
import { FirestoreNoteRepository } from './infra/firestore/firestoreNoteRepository.js';

export interface ServiceContainer {
  noteRepository: NoteRepository;
}

export interface ServiceConfig {
  gcpProjectId: string;
}

let container: ServiceContainer | null = null;

export function initServices(_config: ServiceConfig): void {
  container = {
    noteRepository: new FirestoreNoteRepository(),
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
