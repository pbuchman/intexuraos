/**
 * WhatsApp Service V1 Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────
 * GET    /v1/webhooks/whatsapp     → ./routes/webhookRoutes.ts
 * POST   /v1/webhooks/whatsapp     → ./routes/webhookRoutes.ts
 * POST   /whatsapp/connect      → ./routes/mappingRoutes.ts
 * GET    /whatsapp/status       → ./routes/mappingRoutes.ts
 * DELETE /whatsapp/disconnect   → ./routes/mappingRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { createV1Routes } from './routes/index.js';
