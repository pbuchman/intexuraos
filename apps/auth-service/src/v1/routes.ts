/**
 * Auth Service V1 Routes
 *
 * Route URL → File mapping:
 * ─────────────────────────────────────────────────────────────
 * POST /v1/auth/device/start     → ./routes/deviceRoutes.ts
 * POST /v1/auth/device/poll      → ./routes/deviceRoutes.ts
 * POST /v1/auth/refresh          → ./routes/tokenRoutes.ts
 * GET  /v1/auth/config           → ./routes/configRoutes.ts
 * POST /v1/auth/oauth/token      → ./routes/oauthRoutes.ts
 * GET  /v1/auth/oauth/authorize  → ./routes/oauthRoutes.ts
 * GET  /v1/auth/login            → ./routes/frontendRoutes.ts
 * GET  /v1/auth/logout           → ./routes/frontendRoutes.ts
 * GET  /v1/auth/me               → ./routes/frontendRoutes.ts
 * ─────────────────────────────────────────────────────────────
 */

export { v1AuthRoutes } from './routes/index.js';
