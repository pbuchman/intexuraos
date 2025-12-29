/**
 * user-service domain layer - Identity module.
 *
 * Provides:
 * - models/    Domain entities (AuthToken, AuthError)
 * - ports/     Interfaces for external dependencies (AuthTokenRepository, Auth0Client)
 * - usecases/  Business logic (refreshAccessToken)
 */

// Models
export type { AuthTokens, AuthTokensPublic, RefreshResult } from './models/AuthToken.js';
export type { AuthError, AuthErrorCode } from './models/AuthError.js';

// Ports
export type { AuthTokenRepository } from './ports/AuthTokenRepository.js';
export type { Auth0Client } from './ports/Auth0Client.js';

// Usecases
export {
  type RefreshAccessTokenInput,
  type RefreshAccessTokenResult,
  type RefreshAccessTokenError,
  type RefreshAccessTokenErrorCode,
  type RefreshAccessTokenDeps,
  refreshAccessToken,
} from './usecases/index.js';
