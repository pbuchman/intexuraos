/**
 * Guest session signer.
 *
 * Issues and verifies short-lived HS256 JWTs used as signed guest session IDs.
 * Prevents the client from picking its own session identifier (which would
 * allow trivially bypassing per-session rate limits by rotating the UUID).
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import * as jose from 'jose';

export interface GuestSessionPayload {
  sub: string;
  issuedAt: number;
  expiresAt: number;
}

export type GuestSessionError =
  | { code: 'INVALID_SIGNATURE'; message: string }
  | { code: 'EXPIRED'; message: string };

export interface GuestSessionSigner {
  issue(): Promise<{ token: string; sub: string; expiresAt: number }>;
  verify(token: string): Promise<Result<GuestSessionPayload, GuestSessionError>>;
}

export interface GuestSessionSignerConfig {
  secret: string;
  ttlSeconds: number;
}

const ISSUER = 'intexuraos-chat-agent';
const AUDIENCE = 'intexuraos-guest-chat';

export function createGuestSessionSigner(
  config: GuestSessionSignerConfig
): GuestSessionSigner {
  const key = new TextEncoder().encode(config.secret);

  return {
    async issue(): Promise<{ token: string; sub: string; expiresAt: number }> {
      const sub = crypto.randomUUID();
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAtSec = issuedAt + config.ttlSeconds;
      const token = await new jose.SignJWT({})
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(sub)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAtSec)
        .sign(key);
      return { token, sub, expiresAt: expiresAtSec * 1000 };
    },

    async verify(
      token: string
    ): Promise<Result<GuestSessionPayload, GuestSessionError>> {
      if (token.length === 0) {
        return err({ code: 'INVALID_SIGNATURE', message: 'Empty token' });
      }
      try {
        const { payload } = await jose.jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
        });
        const sub = payload.sub;
        const iat = payload.iat;
        const exp = payload.exp;
        if (typeof sub !== 'string' || sub.length === 0) {
          return err({ code: 'INVALID_SIGNATURE', message: 'Missing sub' });
        }
        if (typeof iat !== 'number' || typeof exp !== 'number') {
          return err({ code: 'INVALID_SIGNATURE', message: 'Missing iat/exp' });
        }
        return ok({ sub, issuedAt: iat * 1000, expiresAt: exp * 1000 });
      } catch (e) {
        if (e instanceof jose.errors.JWTExpired) {
          return err({ code: 'EXPIRED', message: 'Token expired' });
        }
        return err({
          code: 'INVALID_SIGNATURE',
          message: getErrorMessage(e, 'Verification failed'),
        });
      }
    },
  };
}
