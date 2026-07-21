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
 * GET    /whatsapp/private/messages/:messageId/media      → ./privateMediaRoutes.ts
 * GET    /whatsapp/private/messages/:messageId/thumbnail  → ./privateMediaRoutes.ts
 * GET    /whatsapp/private/media-access                   → ./privateMediaRoutes.ts
 * POST   /internal/whatsapp/private/media         → ./privateMediaRoutes.ts
 * GET    /internal/whatsapp/private/matrix-delivery-status/:userId → ./privateMatrixOutboundRoutes.ts
 * POST   /internal/whatsapp/private/outbound-matrix-messages → ./privateMatrixOutboundRoutes.ts
 * GET    /internal/whatsapp/private/messages/:messageId/media → ./privateMediaRoutes.ts
 * POST   /internal/whatsapp/private/conversation-context → ./privateSyncRoutes.ts
 * POST   /internal/whatsapp/pubsub/send-message   → ./pubsubRoutes.ts
 * POST   /internal/whatsapp/webhooks/retry-pending → ./internalRoutes.ts
 * POST   /internal/whatsapp/private/events        → ./privateSyncRoutes.ts
 * POST   /internal/whatsapp/private/accounts/:sourceAccountId/erasure → ./privateErasureRoutes.ts
 * GET    /internal/whatsapp/private/accounts/:sourceAccountId/erasure/:erasureRequestId → ./privateErasureRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { createWhatsappRoutes } from './index.js';
