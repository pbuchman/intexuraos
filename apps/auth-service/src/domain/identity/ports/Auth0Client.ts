/**
 * Port for Auth0 OAuth2 operations.
 * Implemented by infra layer.
 */

import type { Result } from '@intexuraos/common-core';
import type { RefreshResult } from '../models/AuthToken.js';
import type { AuthError } from '../models/AuthError.js';

/**
 * Auth0 OAuth2 client interface.
 */
export interface Auth0Client {
  /**
   * Exchange refresh token for new access token.
   * May return new refresh token if rotation is enabled.
   */
  refreshAccessToken(refreshToken: string): Promise<Result<RefreshResult, AuthError>>;
}
