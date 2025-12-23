/**
 * Auth token domain models.
 * Represents OAuth2/OIDC tokens in the system.
 */

/**
 * OAuth2/OIDC tokens for a user.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  scope?: string | undefined;
  idToken?: string | undefined;
}

/**
 * Public view of stored tokens (no sensitive data).
 */
export interface AuthTokensPublic {
  userId: string;
  hasRefreshToken: boolean;
  expiresAt: string;
  scope?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/**
 * Token refresh result.
 */
export interface RefreshResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope?: string | undefined;
  idToken?: string | undefined;
  refreshToken?: string | undefined; // new refresh token if rotation is enabled
}
