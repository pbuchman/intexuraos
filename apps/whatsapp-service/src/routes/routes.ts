/**
 * WhatsApp Service Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────
 * GET    /webhooks                     → ./webhookRoutes.ts
 * POST   /webhooks                     → ./webhookRoutes.ts
 * POST   /whatsapp/connect             → ./mappingRoutes.ts
 * GET    /whatsapp/status              → ./mappingRoutes.ts
 * DELETE /whatsapp/disconnect          → ./mappingRoutes.ts
 * GET    /whatsapp/messages            → ./messageRoutes.ts
 * GET    /whatsapp/messages/:message_id/media     → ./messageMediaRoutes.ts
 * GET    /whatsapp/messages/:message_id/thumbnail → ./messageMediaRoutes.ts
 * DELETE /whatsapp/messages/:message_id           → ./messageMediaRoutes.ts
 * GET    /whatsapp/preferences        → ./preferencesRoutes.ts
 * PUT    /whatsapp/preferences        → ./preferencesRoutes.ts
 * GET    /whatsapp/private/account    → ./privateReadRoutes.ts
 * PUT    /whatsapp/private/account    → ./privateReadRoutes.ts
 * DELETE /whatsapp/private/account    → ./privateReadRoutes.ts
 * GET    /whatsapp/private/senders    → ./privateReadRoutes.ts
 * GET    /whatsapp/private/messages   → ./privateReadRoutes.ts
 * GET    /whatsapp/private/sender-days → ./privateReadRoutes.ts
 * POST   /internal/whatsapp/pubsub/send-message   → ./pubsubRoutes.ts
 * POST   /internal/whatsapp/webhooks/retry-pending → ./internalRoutes.ts
 * POST   /internal/whatsapp/private/events        → ./privateSyncRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { createWhatsappRoutes } from './index.js';
