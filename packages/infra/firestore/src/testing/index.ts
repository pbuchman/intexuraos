/**
 * Testing utilities for @praxos/infra-firestore.
 *
 * Exports:
 * - In-memory fakes for domain package testing (no external deps)
 * - Emulator utilities for infra/apps testing (real implementations)
 */

// Fakes for domain package testing
export { FakeNotionConnectionRepository } from './fakeNotionConnectionRepository.js';
export { FakeIdempotencyLedger } from './fakeIdempotencyLedger.js';
export { FakeWhatsAppWebhookEventRepository } from './fakeWhatsAppWebhookEventRepository.js';
export { FakeWhatsAppUserMappingRepository } from './fakeWhatsAppUserMappingRepository.js';

// Emulator utilities for infra/apps testing
export {
  ensureEmulator,
  stopEmulator,
  clearEmulatorData,
  isEmulatorRunning,
  getEmulatorHost,
  createEmulatorFirestore,
} from './emulator.js';
