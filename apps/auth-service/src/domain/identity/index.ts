/**
 * Auth-service domain layer - Identity module.
 *
 * Provides:
 * - models/    Domain entities (AuthToken, AuthError)
 * - ports/     Interfaces for external dependencies (AuthTokenRepository, Auth0Client)
 */

// Models
export type { AuthTokens, AuthTokensPublic, RefreshResult } from './models/AuthToken.js';
export type { AuthError, AuthErrorCode } from './models/AuthError.js';

// Ports
export type { AuthTokenRepository } from './ports/AuthTokenRepository.js';
export type { Auth0Client } from './ports/Auth0Client.js';
