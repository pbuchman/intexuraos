/**
 * PromptVault Service Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────────────────────
 * GET   /prompt-vault/main-page         → ./promptRoutes.ts
 * GET   /prompt-vault/prompts           → ./promptRoutes.ts
 * POST  /prompt-vault/prompts           → ./promptRoutes.ts
 * GET   /prompt-vault/prompts/:prompt_id  → ./promptRoutes.ts
 * PATCH /prompt-vault/prompts/:prompt_id  → ./promptRoutes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NOTE: Notion integration management (connect/disconnect/status) and webhooks
 * are handled by the notion-service.
 */

export { promptVaultRoutes } from './index.js';
