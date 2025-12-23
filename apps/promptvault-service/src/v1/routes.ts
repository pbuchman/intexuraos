/**
 * PromptVault Service V1 Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────────────────────
 * POST   /v1/integrations/notion/connect              → ./routes/integrationRoutes.ts
 * GET    /v1/integrations/notion/status               → ./routes/integrationRoutes.ts
 * DELETE /v1/integrations/notion/disconnect           → ./routes/integrationRoutes.ts
 * GET   /v1/tools/notion/promptvault/main-page       → ./routes/promptRoutes.ts
 * GET   /v1/tools/notion/promptvault/prompts         → ./routes/promptRoutes.ts
 * POST  /v1/tools/notion/promptvault/prompts         → ./routes/promptRoutes.ts
 * GET   /v1/tools/notion/promptvault/prompts/:id     → ./routes/promptRoutes.ts
 * PATCH /v1/tools/notion/promptvault/prompts/:id     → ./routes/promptRoutes.ts
 * POST  /v1/webhooks/notion                          → ./routes/webhookRoutes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

export { v1Routes } from './routes/index.js';
