/**
 * Helpers for unwrapping the IntexuraOS service response envelope.
 *
 * All internal HTTP endpoints return a `{ success, data?, error? }`
 * payload. `unwrapEnvelope` converts that into a structural Result:
 *  - `{ ok: true, value: T }` on success.
 *  - `{ ok: false, error: { code, message } }` on either an envelope-level
 *    error (server returned `success: false`) or a malformed/unknown body
 *    that doesn't match the contract.
 *
 * Keeping the discriminator narrow lets clients pattern-match on a stable
 * shape regardless of which service they called.
 */

export interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export type EnvelopeResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE'; message: string };
    };

/**
 * Convert a parsed response body into an `EnvelopeResult`.
 *
 * Treats anything that's not a `{ success: ..., ... }` object as
 * `MALFORMED_ENVELOPE` to keep callers safe from surprise upstream
 * payloads.
 */
export function unwrapEnvelope<T>(body: unknown): EnvelopeResult<T> {
  if (body === null || typeof body !== 'object' || !('success' in body)) {
    return {
      ok: false,
      error: {
        code: 'MALFORMED_ENVELOPE',
        message: 'Response does not match {success, data?, error?} contract',
      },
    };
  }

  const env = body as Envelope<T>;
  if (env.success === true) {
    if (!('data' in env)) {
      return {
        ok: false,
        error: {
          code: 'MALFORMED_ENVELOPE',
          message: 'success=true but no `data`',
        },
      };
    }
    return { ok: true, value: env.data as T };
  }

  const msg = env.error ? `${env.error.code}: ${env.error.message}` : 'unknown';
  return { ok: false, error: { code: 'ENVELOPE_ERROR', message: msg } };
}
