/**
 * verifyInternalAuth — constant-time check of the `X-Internal-Auth` header
 * against the configured shared secret.
 *
 * Used by Cloud Functions / workers that accept HTTP traffic from sister
 * IntexuraOS services (e.g. `vm-lifecycle`). The header value MUST be the raw
 * token; `Bearer <token>` is rejected — that legacy format is the bug fixed
 * by INT-1530.
 *
 * Failure semantics (returns `false`, never throws):
 * - `expectedToken` undefined or empty → 401 (a config bug must NOT degrade
 *   into "everyone is authenticated").
 * - Header missing / empty / array-with-no-elements → 401.
 * - Length mismatch → 401 (without invoking `timingSafeEqual`, which throws
 *   on unequal lengths).
 */
import { timingSafeEqual } from 'node:crypto';

export function verifyInternalAuth(
  headerValue: string | string[] | undefined,
  expectedToken: string | undefined // @allow-undefined-type -- frozen §3.3 signature; keeps passthrough of process.env[KEY] without ?? '' coercion in callers
): boolean {
  if (expectedToken === undefined || expectedToken === '') return false;
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (header === undefined || header === '') return false;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expectedToken);
  if (headerBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(headerBuf, expectedBuf);
}
