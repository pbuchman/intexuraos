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
 * GET    /whatsapp/messages/:message_id/media     → ./messageRoutes.ts
 * GET    /whatsapp/messages/:message_id/thumbnail → ./messageRoutes.ts
 * DELETE /whatsapp/messages/:message_id           → ./messageRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { createWhatsappRoutes } from './index.js';
