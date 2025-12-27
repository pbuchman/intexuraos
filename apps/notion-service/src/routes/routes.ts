/**
 * Notion Service Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────────────────────
 * POST   /notion/connect              → ./integrationRoutes.ts
 * GET    /notion/status               → ./integrationRoutes.ts
 * DELETE /notion/disconnect           → ./integrationRoutes.ts
 * POST   /notion-webhooks             → ./webhookRoutes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

export { notionRoutes } from './index.js';
