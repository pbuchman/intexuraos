/**
 * Auth Service Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────
 * POST /auth/device/start     → ./deviceRoutes.ts
 * POST /auth/device/poll      → ./deviceRoutes.ts
 * POST /auth/refresh          → ./tokenRoutes.ts
 * GET  /auth/config           → ./configRoutes.ts
 * POST /auth/oauth/token      → ./oauthRoutes.ts
 * GET  /auth/oauth/authorize  → ./oauthRoutes.ts
 * GET  /auth/login            → ./frontendRoutes.ts
 * GET  /auth/logout           → ./frontendRoutes.ts
 * GET  /auth/me               → ./frontendRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { authRoutes } from './index.js';
