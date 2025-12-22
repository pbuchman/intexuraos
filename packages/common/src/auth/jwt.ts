/**
 * JWT verification using JWKS.
 * Validates tokens locally without per-request introspection.
 */

import * as jose from 'jose';
import { PraxOSError } from '../http/errors.js';

/**
 * JWT configuration for validation.
 */
export interface JwtConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

/**
 * Verified JWT result.
 */
export interface VerifiedJwt {
  sub: string;
  claims: Record<string, unknown>;
}

// Cache JWKS per URL to avoid repeated fetches
const jwksCache = new Map<string, jose.JWTVerifyGetKey>();

/**
 * Get or create a JWKS client for the given URL.
 */
function getJwksClient(jwksUrl: string): jose.JWTVerifyGetKey {
  let client = jwksCache.get(jwksUrl);
  if (!client) {
    client = jose.createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, client);
  }
  return client;
}

/**
 * Clear JWKS cache. Used for testing.
 */
export function clearJwksCache(): void {
  jwksCache.clear();
}

/**
 * Verify a JWT token using JWKS.
 *
 * @param token - The JWT token string (without Bearer prefix)
 * @param config - JWT validation configuration
 * @returns Verified JWT with sub claim and all claims
 * @throws PraxOSError with UNAUTHORIZED code on failure
 */
export async function verifyJwt(token: string, config: JwtConfig): Promise<VerifiedJwt> {
  if (token === '') {
    throw new PraxOSError('UNAUTHORIZED', 'Token is empty');
  }

  const jwks = getJwksClient(config.jwksUrl);

  let payload: jose.JWTPayload;
  try {
    const result = await jose.jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
    });
    payload = result.payload;
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new PraxOSError('UNAUTHORIZED', 'Token has expired');
    }

    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      throw new PraxOSError('UNAUTHORIZED', `Token validation failed: ${error.message}`);
    }

    if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      throw new PraxOSError('UNAUTHORIZED', 'Invalid token signature');
    }

    if (error instanceof jose.errors.JOSEError) {
      throw new PraxOSError('UNAUTHORIZED', `Token error: ${error.message}`);
    }

    throw new PraxOSError('UNAUTHORIZED', 'Token verification failed');
  }

  // Validate sub claim after try-catch to avoid throw-inside-catch anti-pattern
  const sub = payload.sub;
  if (sub === undefined || sub === '') {
    throw new PraxOSError('UNAUTHORIZED', 'Token missing sub claim');
  }

  // Extract all claims as a plain object
  const claims: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    claims[key] = value;
  }

  return {
    sub,
    claims,
  };
}
