/**
 * Sensitive data redaction utilities.
 * Ensures tokens and secrets never appear in logs or error messages.
 */

/**
 * Redact a token/secret value for safe logging.
 * Shows first 4 and last 4 characters only.
 */
export function redactToken(token: string | undefined | null): string {
  if (token === undefined || token === null || token === '') {
    return '[empty]';
  }

  if (token.length <= 12) {
    return '[REDACTED]';
  }

  const start = token.substring(0, 4);
  const end = token.substring(token.length - 4);
  return `${start}...${end}`;
}

/**
 * Redact an object containing sensitive fields.
 * Creates a copy with specified fields redacted.
 */
export function redactObject(
  obj: Record<string, unknown>,
  sensitiveFields: string[]
): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...obj };

  for (const field of sensitiveFields) {
    if (field in redacted) {
      const value = redacted[field];
      if (typeof value === 'string') {
        redacted[field] = redactToken(value);
      }
    }
  }

  return redacted;
}

/**
 * Common sensitive field names that should be redacted.
 */
export const SENSITIVE_FIELDS = [
  'password',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'device_code',
  'authorization',
  'secret',
  'api_key',
  'apiKey',
  'client_secret',
  'clientSecret',
] as const;
