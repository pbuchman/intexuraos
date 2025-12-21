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
 * - testing/                            Test fakes for use in other packages
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

// Testing utilities (for use by consuming packages)
export {
  FakeNotionConnectionRepository,
  FakeIdempotencyLedger,
  FakeWhatsAppWebhookEventRepository,
} from './testing/index.js';
