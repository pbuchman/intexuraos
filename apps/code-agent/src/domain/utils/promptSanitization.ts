/**
 * Prompt sanitization utility for code-agent worker inputs.
 *
 * INT-612: Strips known secret patterns, redacts URLs with embedded tokens,
 * normalizes whitespace, and enforces maximum prompt length.
 *
 * Pure function with no external dependencies.
 */

/**
 * Maximum allowed prompt length (aligned with existing schema validation).
 */
export const MAX_PROMPT_LENGTH = 100_000;

/**
 * AWS Access Key ID pattern: AKIA followed by 16 alphanumeric characters.
 */
const AWS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/g;

/**
 * OpenAI / Anthropic API key pattern: sk- or sk-ant- followed by key characters.
 * Must be at least 20 chars after sk- to avoid false positives like "sk-mode".
 */
const API_KEY_PATTERN = /sk-(?:ant-)?[a-zA-Z0-9_-]{20,}/g;

/**
 * Stripe secret key pattern: sk_live_ or sk_test_ followed by alphanumeric characters.
 */
const STRIPE_KEY_PATTERN = /sk_(?:live|test)_[a-zA-Z0-9]{24,}/g;

/**
 * GitHub token patterns: ghp_, gho_, ghs_, ghr_ followed by alphanumeric characters.
 */
const GITHUB_TOKEN_PATTERN = /gh[pors]_[a-zA-Z0-9]{16,}/g;

/**
 * Slack token patterns: xoxb-, xoxp-, xoxa-, xoxr-, xoxs- followed by token characters.
 */
const SLACK_TOKEN_PATTERN = /xox[bpars]-[0-9A-Za-z-]{24,}/g;

/**
 * Bearer token pattern: "Bearer " followed by a JWT token (three base64url segments).
 * Tightened to JWT shape to avoid false positives on variable names.
 */
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/**
 * Private key block pattern (PEM format).
 * Matches RSA, EC, DSA, and generic PRIVATE KEY blocks.
 */
const PRIVATE_KEY_PATTERN = /-----BEGIN\s+(?:\w+\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:\w+\s+)?PRIVATE\s+KEY-----/g;

/**
 * Secret assignment pattern in environment variables.
 * Matches KEY_PASSWORD=, KEY_PASSWD=, KEY_SECRET= followed by value (quoted or unquoted).
 * Quoted values with spaces are fully consumed (e.g. DB_PASSWORD="my secret value").
 * Word boundary anchors prevent quadratic backtracking on long word-character strings.
 */
const SECRET_ENV_PATTERN = /\b(\w*(?:PASSWORD|PASSWD|SECRET)\w*)=(?:"[^"]*"|'[^']*'|[^\s"']+)/gi;

/**
 * Sensitive URL query parameter names.
 * Note: 'password' and 'secret' are NOT included here — SECRET_ENV_PATTERN (case-insensitive)
 * already handles any param containing PASSWORD/PASSWD/SECRET. Including them here would
 * cause double-processing (SECRET_ENV_PATTERN runs first, then this would overwrite the
 * redaction marker from [REDACTED_SECRET] to [REDACTED]).
 */
const SENSITIVE_PARAM_NAMES = ['token', 'api_key', 'apikey', 'access_token'];

/**
 * Pattern to match sensitive query parameters in URLs.
 * Anchored to URL context: requires ? or & prefix to avoid matching env var assignments.
 */
const SENSITIVE_URL_PARAM_PATTERN = new RegExp(
  `([?&])(${SENSITIVE_PARAM_NAMES.join('|')})=([^&\\s"']+)`,
  'gi'
);

/**
 * Sanitize a user prompt by stripping known secret patterns, redacting URLs
 * with embedded tokens, normalizing whitespace, and enforcing max length.
 *
 * @param prompt - Raw user prompt
 * @returns Sanitized prompt string
 */
export function sanitizePrompt(prompt: string): string {
  // Handle empty / whitespace-only input early
  if (prompt.trim().length === 0) {
    return '';
  }

  let result = prompt;

  // Step 1: Redact private key blocks (must run before other patterns to avoid partial matches)
  result = result.replace(PRIVATE_KEY_PATTERN, '[REDACTED_PRIVATE_KEY]');

  // Step 2: Redact AWS access key IDs
  result = result.replace(AWS_KEY_PATTERN, '[REDACTED_AWS_KEY]');

  // Step 3: Redact API keys (OpenAI, Anthropic)
  result = result.replace(API_KEY_PATTERN, '[REDACTED_API_KEY]');

  // Step 4: Redact Stripe secret keys
  result = result.replace(STRIPE_KEY_PATTERN, '[REDACTED_STRIPE_KEY]');

  // Step 5: Redact GitHub tokens
  result = result.replace(GITHUB_TOKEN_PATTERN, '[REDACTED_GH_TOKEN]');

  // Step 6: Redact Slack tokens
  result = result.replace(SLACK_TOKEN_PATTERN, '[REDACTED_SLACK_TOKEN]');

  // Step 7: Redact Bearer tokens (JWT-shaped only to avoid false positives)
  result = result.replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED_BEARER]');

  // Step 8: Redact secret/password env var assignments
  result = result.replace(SECRET_ENV_PATTERN, '$1=[REDACTED_SECRET]');

  // Step 9: Redact sensitive URL query parameters (preserving ? or & prefix)
  result = result.replace(SENSITIVE_URL_PARAM_PATTERN, '$1$2=[REDACTED]');

  // Step 10: Enforce maximum length AFTER redaction to prevent secrets straddling
  // the truncation boundary from being only partially redacted (e.g. a PEM block
  // whose BEGIN and body are kept but END is cut, preventing pattern match).
  if (result.length > MAX_PROMPT_LENGTH) {
    result = result.substring(0, MAX_PROMPT_LENGTH);
  }

  // Step 11: Normalize whitespace
  // - Trim leading and trailing whitespace
  result = result.trim();
  // - Collapse multiple consecutive spaces (within a line) to single space
  result = result.replace(/[^\S\n]+/g, ' ');
  // - Collapse 3+ consecutive newlines to double newline (preserve paragraph breaks)
  result = result.replace(/\n{3,}/g, '\n\n');
  // - Trim trailing spaces on each line
  result = result.replace(/ +\n/g, '\n');

  return result;
}
