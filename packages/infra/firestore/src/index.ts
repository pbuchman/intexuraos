/**
 * @praxos/infra-firestore
 *
 * Firestore infrastructure adapter - implements domain persistence ports.
 *
 * Structure:
 * - client.ts                           Firestore client singleton
 * - authTokenRepository.ts              Per-user Auth0 token storage (encrypted)
 * - notionConnectionRepository.ts       Per-user Notion config storage
 * - whatsappUserMappingRepository.ts    Per-user WhatsApp mapping storage
 * - idempotencyLedger.ts                Idempotency tracking
 * - whatsappWebhookEventRepository.ts   WhatsApp webhook event storage
 * - encryption.ts                       Token encryption utilities
 * - testing/                            Test utilities (fakes + emulator)
 */

// Client
export { getFirestore, resetFirestore, setFirestore } from './client.js';

// Adapters
export { FirestoreAuthTokenRepository } from './authTokenRepository.js';
export { FirestoreNotionConnectionRepository } from './notionConnectionRepository.js';
export { FirestoreWhatsAppUserMappingRepository } from './whatsappUserMappingRepository.js';
export { FirestoreIdempotencyLedger } from './idempotencyLedger.js';
export { FirestoreWhatsAppWebhookEventRepository } from './whatsappWebhookEventRepository.js';

// Encryption utilities
export { encryptToken, decryptToken, generateEncryptionKey } from './encryption.js';

// Testing utilities - fakes for domain package testing
export {
  FakeNotionConnectionRepository,
  FakeIdempotencyLedger,
  FakeWhatsAppWebhookEventRepository,
  FakeWhatsAppUserMappingRepository,
} from './testing/index.js';

// Testing utilities - emulator for infra/apps testing
export {
  ensureEmulator,
  stopEmulator,
  clearEmulatorData,
  isEmulatorRunning,
  getEmulatorHost,
  createEmulatorFirestore,
} from './testing/index.js';
