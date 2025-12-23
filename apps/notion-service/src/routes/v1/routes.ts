/**
 * Notion Service V1 Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────────────────────
 * POST   /v1/integrations/notion/connect              → ./integrationRoutes.ts
 * GET    /v1/integrations/notion/status               → ./integrationRoutes.ts
 * DELETE /v1/integrations/notion/disconnect           → ./integrationRoutes.ts
 * POST   /v1/webhooks/notion                          → ./webhookRoutes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

export { v1Routes } from './index.js';
