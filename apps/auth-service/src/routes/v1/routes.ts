/**
 * Auth Service V1 Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────
 * POST /v1/auth/device/start     → ./deviceRoutes.ts
 * POST /v1/auth/device/poll      → ./deviceRoutes.ts
 * POST /v1/auth/refresh          → ./tokenRoutes.ts
 * GET  /v1/auth/config           → ./configRoutes.ts
 * POST /v1/auth/oauth/token      → ./oauthRoutes.ts
 * GET  /v1/auth/oauth/authorize  → ./oauthRoutes.ts
 * GET  /v1/auth/login            → ./frontendRoutes.ts
 * GET  /v1/auth/logout           → ./frontendRoutes.ts
 * GET  /v1/auth/me               → ./frontendRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { v1AuthRoutes } from './index.js';
