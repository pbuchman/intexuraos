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
 * GitHub token patterns: ghp_, gho_, ghs_, ghr_ followed by alphanumeric characters.
 */
const GITHUB_TOKEN_PATTERN = /gh[pors]_[a-zA-Z0-9]{16,}/g;

/**
 * Bearer token pattern: "Bearer " followed by a JWT or opaque token.
 * Matches both inside and outside code blocks.
 */
const BEARER_TOKEN_PATTERN = /Bearer\s+[a-zA-Z0-9._-]{20,}/g;

/**
 * Private key block pattern (PEM format).
 * Matches RSA, EC, DSA, and generic PRIVATE KEY blocks.
 */
const PRIVATE_KEY_PATTERN = /-----BEGIN\s+(?:\w+\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:\w+\s+)?PRIVATE\s+KEY-----/g;

/**
 * Password assignment pattern in environment variables.
 * Matches KEY_PASSWORD= or KEY_SECRET= followed by value (quoted or unquoted).
 */
const PASSWORD_ENV_PATTERN = /(\w*(?:PASSWORD|PASSWD)\w*)=["']?([^\s"']+)["']?/gi;

/**
 * Sensitive URL query parameter names.
 */
const SENSITIVE_PARAM_NAMES = ['token', 'api_key', 'apikey', 'secret', 'access_token', 'password'];

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

  // Step 1: Enforce maximum length early to avoid expensive regex on huge strings
  if (result.length > MAX_PROMPT_LENGTH) {
    result = result.substring(0, MAX_PROMPT_LENGTH);
  }

  // Step 2: Redact private key blocks (must run before other patterns to avoid partial matches)
  result = result.replace(PRIVATE_KEY_PATTERN, '[REDACTED_PRIVATE_KEY]');

  // Step 3: Redact AWS access key IDs
  result = result.replace(AWS_KEY_PATTERN, '[REDACTED_AWS_KEY]');

  // Step 4: Redact API keys (OpenAI, Anthropic)
  result = result.replace(API_KEY_PATTERN, '[REDACTED_API_KEY]');

  // Step 5: Redact GitHub tokens
  result = result.replace(GITHUB_TOKEN_PATTERN, '[REDACTED_GH_TOKEN]');

  // Step 6: Redact Bearer tokens
  result = result.replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED_BEARER]');

  // Step 7: Redact password env var assignments
  result = result.replace(PASSWORD_ENV_PATTERN, '$1=[REDACTED_PASSWORD]');

  // Step 8: Redact sensitive URL query parameters (preserving ? or & prefix)
  result = result.replace(SENSITIVE_URL_PARAM_PATTERN, '$1$2=[REDACTED]');

  // Step 9: Normalize whitespace
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
