/**
 * Tests for promptSanitization utility.
 *
 * INT-612: Implement prompt sanitization for code-agent worker inputs.
 */
import { describe, expect, it } from 'vitest';
import { sanitizePrompt, MAX_PROMPT_LENGTH } from '../../../domain/utils/promptSanitization.js';

/**
 * Helper to build test token strings dynamically.
 * Prevents GitHub push protection from flagging test fixtures as real secrets.
 */
function fakeToken(prefix: string, suffix: string): string {
  return prefix + suffix;
}

describe('sanitizePrompt', () => {
  // ─── Basic pass-through ───────────────────────────────────────────
  it('returns prompt unchanged when no secrets present', () => {
    const input = 'Fix the login bug in auth.ts';
    expect(sanitizePrompt(input)).toBe(input);
  });

  // ─── AWS Access Key ───────────────────────────────────────────────
  it('redacts AWS access key patterns', () => {
    const input = 'Use this key AKIAIOSFODNN7EXAMPLE to access the bucket';
    const result = sanitizePrompt(input);
    expect(result).toBe('Use this key [REDACTED_AWS_KEY] to access the bucket');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  // ─── OpenAI / Anthropic API Keys ─────────────────────────────────
  it('redacts OpenAI API key patterns (sk-)', () => {
    const input = 'My API key is sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_API_KEY]');
    expect(result).not.toContain('sk-abc123');
  });

  it('redacts Anthropic API key patterns (sk-ant-)', () => {
    const input = 'Set ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_API_KEY]');
    expect(result).not.toContain('sk-ant-');
  });

  it('does not redact "sk-" as a word fragment without key suffix', () => {
    const input = 'The flag is --sk-mode for skeleton mode';
    const result = sanitizePrompt(input);
    expect(result).toBe('The flag is --sk-mode for skeleton mode');
  });

  it('does not redact non-secret similar patterns', () => {
    const input = 'We should skip this step and proceed';
    expect(sanitizePrompt(input)).toBe('We should skip this step and proceed');
  });

  // ─── Stripe Secret Keys ──────────────────────────────────────────
  it('redacts Stripe live secret key patterns', () => {
    const stripeKey = fakeToken('sk_live_', 'abcdefghijklmnopqrstuvwx');
    const input = `Use Stripe key ${stripeKey}`;
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_STRIPE_KEY]');
    expect(result).not.toContain('sk_live_');
  });

  it('redacts Stripe test secret key patterns', () => {
    const stripeKey = fakeToken('sk_test_', 'abcdefghijklmnopqrstuvwx');
    const input = `Test with ${stripeKey}`;
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_STRIPE_KEY]');
    expect(result).not.toContain('sk_test_');
  });

  // ─── GitHub Tokens ────────────────────────────────────────────────
  it('redacts GitHub token patterns (ghp_)', () => {
    const input = 'Clone with token ghp_ABCDEFghijklmnopqrstuvwxyz1234567890';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_GH_TOKEN]');
    expect(result).not.toContain('ghp_');
  });

  it('redacts GitHub token patterns (gho_, ghs_)', () => {
    const input = 'OAuth: gho_abcdefghijklmnop, Server: ghs_abcdefghijklmnop';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_GH_TOKEN]');
    expect(result).not.toContain('gho_');
    expect(result).not.toContain('ghs_');
  });

  it('redacts GitHub refresh token patterns (ghr_)', () => {
    const input = 'Refresh token: ghr_abcdefghijklmnop';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_GH_TOKEN]');
    expect(result).not.toContain('ghr_');
  });

  // ─── Slack Tokens ─────────────────────────────────────────────────
  it('redacts Slack bot token patterns (xoxb-)', () => {
    const slackToken = fakeToken('xoxb-', '123456789012-123456789012-AbCdEfGhIjKlMnOp');
    const input = `Bot token: ${slackToken}`;
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_SLACK_TOKEN]');
    expect(result).not.toContain('xoxb-');
  });

  it('redacts Slack user token patterns (xoxp-)', () => {
    const slackToken = fakeToken('xoxp-', '123456789012-123456789012-AbCdEfGhIjKlMnOp');
    const input = `User token: ${slackToken}`;
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_SLACK_TOKEN]');
    expect(result).not.toContain('xoxp-');
  });

  // ─── Bearer Tokens (JWT-shaped only) ──────────────────────────────
  it('redacts Bearer tokens with JWT shape', () => {
    const input = 'Use `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U` in the header';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_BEARER]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('redacts Bearer tokens outside code blocks too', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMifQ.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ in the header';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_BEARER]');
  });

  it('does not redact Bearer with short non-JWT tokens (avoids false positives)', () => {
    // Short opaque token without JWT structure should NOT be redacted
    const input = 'Authorization: Bearer mytoken123';
    const result = sanitizePrompt(input);
    expect(result).toContain('Bearer mytoken123');
  });

  // ─── Private Key Blocks ───────────────────────────────────────────
  it('redacts RSA private key blocks', () => {
    const input = `Here is the key:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/yGaXEzNjL
-----END RSA PRIVATE KEY-----
Use it carefully`;
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_PRIVATE_KEY]');
    expect(result).not.toContain('MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn');
  });

  it('redacts generic private key blocks', () => {
    const input = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQ
-----END PRIVATE KEY-----`;
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_PRIVATE_KEY]');
  });

  it('redacts EC private key blocks', () => {
    const input = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBkg4LVWM9nuwNSk3yByxZpYRTBnVJk+W
-----END EC PRIVATE KEY-----`;
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_PRIVATE_KEY]');
    expect(result).not.toContain('MHQCAQEEIBkg4LVWM9nuwNSk3yByxZpYRTBnVJk');
  });

  it('redacts DSA private key blocks', () => {
    const input = `-----BEGIN DSA PRIVATE KEY-----
MIIBugIBAAKBgQDN1pSqHA07XWWKP9m3JbPi7r
-----END DSA PRIVATE KEY-----`;
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_PRIVATE_KEY]');
    expect(result).not.toContain('MIIBugIBAAKBgQDN1pSqHA07XWWKP9m3JbPi7r');
  });

  // ─── Secret/Password Env Var Assignments ──────────────────────────
  it('redacts PASSWORD assignments in environment variables', () => {
    const input = 'Set DB_PASSWORD=super_secret_123 in .env';
    const result = sanitizePrompt(input);
    expect(result).toContain('DB_PASSWORD=[REDACTED_SECRET]');
    expect(result).not.toContain('super_secret_123');
  });

  it('redacts PASSWORD assignments with quotes', () => {
    const input = 'DATABASE_PASSWORD="my-secret-pass"';
    const result = sanitizePrompt(input);
    expect(result).toContain('DATABASE_PASSWORD=[REDACTED_SECRET]');
    expect(result).not.toContain('my-secret-pass');
  });

  it('redacts PASSWD assignments', () => {
    const input = 'MYSQL_PASSWD=rootpass123';
    const result = sanitizePrompt(input);
    expect(result).toContain('MYSQL_PASSWD=[REDACTED_SECRET]');
    expect(result).not.toContain('rootpass123');
  });

  it('redacts SECRET assignments in environment variables', () => {
    const input = 'APP_SECRET=my-super-secret-value';
    const result = sanitizePrompt(input);
    expect(result).toContain('APP_SECRET=[REDACTED_SECRET]');
    expect(result).not.toContain('my-super-secret-value');
  });

  it('redacts JWT_SECRET assignments', () => {
    const input = 'JWT_SECRET="very-long-jwt-secret-key-value"';
    const result = sanitizePrompt(input);
    expect(result).toContain('JWT_SECRET=[REDACTED_SECRET]');
    expect(result).not.toContain('very-long-jwt-secret-key-value');
  });

  // ─── URL Query Parameters ─────────────────────────────────────────
  it('redacts URLs with token query params', () => {
    const input = 'Visit https://api.example.com/data?token=secret123&format=json';
    const result = sanitizePrompt(input);
    expect(result).toContain('token=[REDACTED]');
    expect(result).not.toContain('secret123');
  });

  it('redacts URLs with api_key query params', () => {
    const input = 'Fetch from https://api.example.com/data?api_key=mykey123&limit=10';
    const result = sanitizePrompt(input);
    expect(result).toContain('api_key=[REDACTED]');
    expect(result).not.toContain('mykey123');
  });

  it('redacts URLs with apikey query params (no underscore)', () => {
    const input = 'URL: https://api.example.com/data?apikey=mykey456';
    const result = sanitizePrompt(input);
    expect(result).toContain('apikey=[REDACTED]');
    expect(result).not.toContain('mykey456');
  });

  it('redacts URLs with secret query params (via SECRET_ENV_PATTERN)', () => {
    // ?secret=value is handled by SECRET_ENV_PATTERN (case-insensitive), not SENSITIVE_URL_PARAM_PATTERN,
    // to avoid double-processing. The result uses [REDACTED_SECRET] consistently.
    const input = 'URL: https://hooks.example.com/callback?secret=abc123xyz';
    const result = sanitizePrompt(input);
    expect(result).toContain('secret=[REDACTED_SECRET]');
    expect(result).not.toContain('abc123xyz');
  });

  it('redacts URLs with access_token query params', () => {
    const input = 'OAuth URL: https://api.example.com/me?access_token=tok_abc123';
    const result = sanitizePrompt(input);
    expect(result).toContain('access_token=[REDACTED]');
    expect(result).not.toContain('tok_abc123');
  });

  it('redacts multiple URL token params in a single URL', () => {
    const input = 'URL: https://api.example.com?token=abc123&api_key=def456&secret=ghi789';
    const result = sanitizePrompt(input);
    expect(result).toContain('token=[REDACTED]');
    expect(result).toContain('api_key=[REDACTED]');
    // 'secret' is handled by SECRET_ENV_PATTERN (case-insensitive), producing [REDACTED_SECRET]
    expect(result).toContain('secret=[REDACTED_SECRET]');
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('def456');
    expect(result).not.toContain('ghi789');
  });

  it('does not double-process ?password= in URLs (handled by SECRET_ENV_PATTERN)', () => {
    // SECRET_ENV_PATTERN catches PASSWORD=value and SECRET=value;
    // these are NOT in SENSITIVE_PARAM_NAMES to avoid double-processing.
    const input = 'URL: https://db.example.com?password=dbpass123';
    const result = sanitizePrompt(input);
    expect(result).toContain('password=[REDACTED_SECRET]');
    expect(result).not.toContain('dbpass123');
  });

  // ─── Whitespace normalization ─────────────────────────────────────
  it('normalizes excessive whitespace', () => {
    const input = '  Fix   the   bug   in    auth.ts  ';
    const result = sanitizePrompt(input);
    expect(result).toBe('Fix the bug in auth.ts');
  });

  it('preserves meaningful newlines', () => {
    const input = 'Fix the bug in auth.ts\n\nAlso update the tests';
    const result = sanitizePrompt(input);
    expect(result).toContain('\n\n');
    expect(result).toBe('Fix the bug in auth.ts\n\nAlso update the tests');
  });

  it('collapses more than two consecutive newlines', () => {
    const input = 'First paragraph\n\n\n\n\nSecond paragraph';
    const result = sanitizePrompt(input);
    expect(result).toBe('First paragraph\n\nSecond paragraph');
  });

  it('trims trailing spaces on lines', () => {
    const input = 'line one   \nline two   ';
    const result = sanitizePrompt(input);
    expect(result).toBe('line one\nline two');
  });

  // ─── Length enforcement ───────────────────────────────────────────
  it('truncates prompts exceeding max length', () => {
    const input = 'a'.repeat(150_000);
    const result = sanitizePrompt(input);
    expect(result.length).toBe(MAX_PROMPT_LENGTH);
  });

  it('does not truncate prompts at or below max length', () => {
    const input = 'a'.repeat(MAX_PROMPT_LENGTH);
    const result = sanitizePrompt(input);
    expect(result.length).toBe(MAX_PROMPT_LENGTH);
  });

  // ─── Edge cases ───────────────────────────────────────────────────
  it('handles empty string', () => {
    expect(sanitizePrompt('')).toBe('');
  });

  it('handles whitespace-only string', () => {
    expect(sanitizePrompt('   \n\n  ')).toBe('');
  });

  it('handles prompt with only secrets (everything redacted)', () => {
    const input = 'AKIAIOSFODNN7EXAMPLE';
    const result = sanitizePrompt(input);
    expect(result).toBe('[REDACTED_AWS_KEY]');
  });

  it('preserves code blocks that do not contain secrets', () => {
    const input = 'Run this command:\n```\nnpm install express\n```\nThen start the server.';
    const result = sanitizePrompt(input);
    expect(result).toContain('npm install express');
    expect(result).toContain('```');
  });

  // ─── Multiple secrets in one prompt ───────────────────────────────
  it('redacts multiple secret patterns in one prompt', () => {
    const input = [
      'Use AWS key AKIAIOSFODNN7EXAMPLE',
      'with GitHub token ghp_ABCDEFghijklmnopqrstuvwxyz1234567890',
      'and Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMifQ.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ in the header',
    ].join('\n');
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_AWS_KEY]');
    expect(result).toContain('[REDACTED_GH_TOKEN]');
    expect(result).toContain('[REDACTED_BEARER]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).not.toContain('ghp_');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts Stripe + Slack + AWS keys together', () => {
    const stripeKey = fakeToken('sk_live_', 'abcdefghijklmnopqrstuvwx');
    const slackToken = fakeToken('xoxb-', '123456789012-123456789012-AbCdEfGhIjKlMnOp');
    const input = [
      `Stripe: ${stripeKey}`,
      `Slack: ${slackToken}`,
      'AWS: AKIAIOSFODNN7EXAMPLE',
    ].join('\n');
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_STRIPE_KEY]');
    expect(result).toContain('[REDACTED_SLACK_TOKEN]');
    expect(result).toContain('[REDACTED_AWS_KEY]');
  });
});
