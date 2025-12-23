/**
 * PromptVault Service V1 Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────────────────────
 * GET   /v1/tools/notion/promptvault/main-page       → ./routes/promptRoutes.ts
 * GET   /v1/tools/notion/promptvault/prompts         → ./routes/promptRoutes.ts
 * POST  /v1/tools/notion/promptvault/prompts         → ./routes/promptRoutes.ts
 * GET   /v1/tools/notion/promptvault/prompts/:id     → ./routes/promptRoutes.ts
 * PATCH /v1/tools/notion/promptvault/prompts/:id     → ./routes/promptRoutes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NOTE: Notion integration management (connect/disconnect/status) and webhooks
 * are handled by the notion-service.
 */

export { v1Routes } from './routes/index.js';
