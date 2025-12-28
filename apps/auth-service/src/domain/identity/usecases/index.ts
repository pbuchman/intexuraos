/**
 * Auth-service domain usecases.
 */

export {
  type RefreshAccessTokenInput,
  type RefreshAccessTokenResult,
  type RefreshAccessTokenError,
  type RefreshAccessTokenErrorCode,
  type RefreshAccessTokenDeps,
  refreshAccessToken,
} from './refreshAccessToken.js';
