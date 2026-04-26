/**
 * Google OIDC ID-token verifier built on `jose`'s remote JWKS.
 *
 * Used by services that accept Pub/Sub push tokens or other Google-signed
 * OIDC bearers. The factory caches the JWKS fetcher across calls; consumers
 * can override `jwksUrl` for tests.
 *
 * Returns a tagged result so callers can distinguish "no header" from
 * "audience mismatch" without re-parsing.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type GoogleOidcResult =
  | { valid: true; subject: string }
  | {
      valid: false;
      reason: 'missing_bearer' | 'audience_mismatch' | 'issuer_mismatch' | 'verification_failed';
    };

export interface GoogleOidcVerifierConfig {
  audience: string;
  jwksUrl?: string;
}

const DEFAULT_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
// Google issues OIDC ID tokens with one of these issuers; both are valid.
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export type GoogleOidcVerifier = (
  authHeader: string | undefined // @allow-undefined-type -- function parameter must accept the absent-header case explicitly; ?: only works on object properties
) => Promise<GoogleOidcResult>;

export function createGoogleOidcVerifier(config: GoogleOidcVerifierConfig): GoogleOidcVerifier {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl ?? DEFAULT_JWKS));
  return async function verify(
    authHeader: string | undefined // @allow-undefined-type -- function parameter must accept the absent-header case explicitly; ?: only works on object properties
  ): Promise<GoogleOidcResult> {
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return { valid: false, reason: 'missing_bearer' };
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const { payload } = await jwtVerify(token, jwks as JWTVerifyGetKey);
      if (payload.aud !== config.audience) {
        return { valid: false, reason: 'audience_mismatch' };
      }
      if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.has(payload.iss)) {
        return { valid: false, reason: 'issuer_mismatch' };
      }
      const email = typeof payload['email'] === 'string' ? payload['email'] : undefined;
      const subject = email ?? payload.sub ?? '';
      return { valid: true, subject };
    } catch {
      return { valid: false, reason: 'verification_failed' };
    }
  };
}
