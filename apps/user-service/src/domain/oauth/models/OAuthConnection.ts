/**
 * OAuth connection domain models.
 */

export const OAuthProviders = {
  GOOGLE: 'google',
} as const;

export type OAuthProvider = (typeof OAuthProviders)[keyof typeof OAuthProviders];

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
}

export interface OAuthConnection {
  userId: string;
  provider: OAuthProvider;
  email: string;
  tokens: OAuthTokens;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthConnectionPublic {
  userId: string;
  provider: OAuthProvider;
  email: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OAuthState {
  userId: string;
  provider: OAuthProvider;
  redirectUri: string;
  createdAt: number;
}
