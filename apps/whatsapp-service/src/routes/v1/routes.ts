/**
 * WhatsApp Service V1 Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────
 * GET    /v1/webhooks/whatsapp     → ./webhookRoutes.ts
 * POST   /v1/webhooks/whatsapp     → ./webhookRoutes.ts
 * POST   /whatsapp/connect         → ./mappingRoutes.ts
 * GET    /whatsapp/status          → ./mappingRoutes.ts
 * DELETE /whatsapp/disconnect      → ./mappingRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { createV1Routes } from './index.js';
