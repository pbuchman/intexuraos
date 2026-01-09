/**
 * user-service domain layer - OAuth module.
 *
 * Provides:
 * - models/    Domain entities (OAuthConnection, OAuthError)
 * - ports/     Interfaces for external dependencies (OAuthConnectionRepository, GoogleOAuthClient)
 * - usecases/  Business logic (initiateOAuthFlow, exchangeOAuthCode, getValidAccessToken, disconnectProvider)
 */

// Models
export {
  OAuthProviders,
  type OAuthProvider,
  type OAuthTokens,
  type OAuthConnection,
  type OAuthConnectionPublic,
  type OAuthState,
} from './models/OAuthConnection.js';
export type { OAuthError, OAuthErrorCode } from './models/OAuthError.js';

// Ports
export type { OAuthConnectionRepository } from './ports/OAuthConnectionRepository.js';
export type {
  GoogleOAuthClient,
  GoogleTokenResponse,
  GoogleUserInfo,
} from './ports/GoogleOAuthClient.js';

// Usecases
export {
  type InitiateOAuthFlowInput,
  type InitiateOAuthFlowResult,
  type InitiateOAuthFlowDeps,
  initiateOAuthFlow,
  type ExchangeOAuthCodeInput,
  type ExchangeOAuthCodeDeps,
  exchangeOAuthCode,
  type GetValidAccessTokenInput,
  type GetValidAccessTokenResult,
  type GetValidAccessTokenDeps,
  getValidAccessToken,
  type DisconnectProviderInput,
  type DisconnectProviderDeps,
  disconnectProvider,
} from './usecases/index.js';
