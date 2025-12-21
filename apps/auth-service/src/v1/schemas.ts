import { z } from 'zod';

/**
 * POST /v1/auth/device/start
 * Request device authorization code from Auth0.
 */
export const deviceStartRequestSchema = z.object({
  audience: z.string().url().optional().default('urn:praxos:api'),
  scope: z.string().optional().default('openid profile email offline_access'),
});

export type DeviceStartRequest = z.infer<typeof deviceStartRequestSchema>;

/**
 * Response from Auth0 device code endpoint.
 */
export interface DeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * POST /v1/auth/device/poll
 * Poll for token after user authorization.
 */
export const devicePollRequestSchema = z.object({
  device_code: z.string().min(1, 'device_code is required'),
});

export type DevicePollRequest = z.infer<typeof devicePollRequestSchema>;

/**
 * Success response from Auth0 token endpoint.
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

/**
 * POST /v1/auth/refresh
 * Refresh access token using stored refresh token.
 */
export const refreshTokenRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

export type RefreshTokenRequest = z.infer<typeof refreshTokenRequestSchema>;

/**
 * GET /v1/auth/config
 * Non-secret auth configuration for troubleshooting.
 */
export interface AuthConfigResponse {
  issuer: string;
  audience: string;
  jwksUrl: string;
  domain: string;
}

/**
 * Auth0 error response structure.
 */
export interface Auth0ErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Check if response is an Auth0 error.
 */
export function isAuth0Error(body: unknown): body is Auth0ErrorResponse {
  if (body === null || typeof body !== 'object') {
    return false;
  }
  const obj = body as Record<string, unknown>;
  return 'error' in obj && typeof obj['error'] === 'string';
}
