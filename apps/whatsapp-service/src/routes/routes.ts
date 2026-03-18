/**
 * WhatsApp Service Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────
 * GET    /whatsapp/webhooks            → ./webhookRoutes.ts
 * POST   /whatsapp/webhooks            → ./webhookRoutes.ts
 * POST   /whatsapp/connect             → ./mappingRoutes.ts
 * GET    /whatsapp/status              → ./mappingRoutes.ts
 * DELETE /whatsapp/disconnect          → ./mappingRoutes.ts
 * GET    /whatsapp/messages            → ./messageRoutes.ts
 * GET    /whatsapp/messages/:message_id/media     → ./messageMediaRoutes.ts
 * GET    /whatsapp/messages/:message_id/thumbnail → ./messageMediaRoutes.ts
 * DELETE /whatsapp/messages/:message_id           → ./messageMediaRoutes.ts
 * POST   /internal/whatsapp/pubsub/send-message   → ./pubsubRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { createWhatsappRoutes } from './index.js';
