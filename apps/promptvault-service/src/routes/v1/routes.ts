/**
 * PromptVault Service V1 Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────────────────────
 * GET   /v1/tools/notion/promptvault/main-page       → ./promptRoutes.ts
 * GET   /v1/tools/notion/promptvault/prompts         → ./promptRoutes.ts
 * POST  /v1/tools/notion/promptvault/prompts         → ./promptRoutes.ts
 * GET   /v1/tools/notion/promptvault/prompts/:id     → ./promptRoutes.ts
 * PATCH /v1/tools/notion/promptvault/prompts/:id     → ./promptRoutes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NOTE: Notion integration management (connect/disconnect/status) and webhooks
 * are handled by the notion-service.
 */

export { v1Routes } from './index.js';
