/**
 * Tests for promptSanitization utility.
 *
 * INT-612: Implement prompt sanitization for code-agent worker inputs.
 */
import { describe, expect, it } from 'vitest';
import { sanitizePrompt, MAX_PROMPT_LENGTH } from '../../../domain/utils/promptSanitization.js';

describe('sanitizePrompt', () => {
  it('returns prompt unchanged when no secrets present', () => {
    const input = 'Fix the login bug in auth.ts';
    expect(sanitizePrompt(input)).toBe(input);
  });

  it('redacts AWS access key patterns', () => {
    const input = 'Use this key AKIAIOSFODNN7EXAMPLE to access the bucket';
    const result = sanitizePrompt(input);
    expect(result).toBe('Use this key [REDACTED_AWS_KEY] to access the bucket');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

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

  it('redacts GitHub token patterns (ghp_)', () => {
    const input = 'Clone with token ghp_ABCDEFghijklmnopqrstuvwxyz1234567890';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_GH_TOKEN]');
    expect(result).not.toContain('ghp_');
  });

  it('redacts GitHub token patterns (gho_, ghs_, ghr_)', () => {
    const input = 'OAuth: gho_abcdefghijklmnop, Server: ghs_abcdefghijklmnop';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_GH_TOKEN]');
    expect(result).not.toContain('gho_');
    expect(result).not.toContain('ghs_');
  });

  it('redacts Bearer tokens in code blocks', () => {
    const input = 'Use `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U` in the header';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_BEARER]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('redacts Bearer tokens outside code blocks too', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc123.signature in the header';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_BEARER]');
  });

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

  it('redacts URLs with secret query params', () => {
    const input = 'URL: https://hooks.example.com/callback?secret=abc123xyz';
    const result = sanitizePrompt(input);
    expect(result).toContain('secret=[REDACTED]');
    expect(result).not.toContain('abc123xyz');
  });

  it('redacts URLs with access_token query params', () => {
    const input = 'OAuth URL: https://api.example.com/me?access_token=tok_abc123';
    const result = sanitizePrompt(input);
    expect(result).toContain('access_token=[REDACTED]');
    expect(result).not.toContain('tok_abc123');
  });

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

  it('handles empty string', () => {
    expect(sanitizePrompt('')).toBe('');
  });

  it('handles whitespace-only string', () => {
    expect(sanitizePrompt('   \n\n  ')).toBe('');
  });

  it('redacts multiple secret patterns in one prompt', () => {
    const input = [
      'Use AWS key AKIAIOSFODNN7EXAMPLE',
      'with GitHub token ghp_ABCDEFghijklmnopqrstuvwxyz1234567890',
      'and Bearer eyJhbGciOiJIUzI1NiJ9.abc123.sig in the header',
    ].join('\n');
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_AWS_KEY]');
    expect(result).toContain('[REDACTED_GH_TOKEN]');
    expect(result).toContain('[REDACTED_BEARER]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).not.toContain('ghp_');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('does not redact non-secret similar patterns', () => {
    // "skip" starts with "sk" but should not be redacted
    const input = 'We should skip this step and proceed';
    expect(sanitizePrompt(input)).toBe('We should skip this step and proceed');
  });

  it('does not redact "sk-" as a word fragment without key suffix', () => {
    // Ensure "sk-" alone in prose is not redacted, only with long key patterns
    const input = 'The flag is --sk-mode for skeleton mode';
    const result = sanitizePrompt(input);
    expect(result).toBe('The flag is --sk-mode for skeleton mode');
  });

  it('redacts private key blocks', () => {
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

  it('redacts password assignments in environment variables', () => {
    const input = 'Set DB_PASSWORD=super_secret_123 in .env';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_PASSWORD]');
    expect(result).not.toContain('super_secret_123');
  });

  it('redacts password assignments with quotes', () => {
    const input = 'DATABASE_PASSWORD="my-secret-pass"';
    const result = sanitizePrompt(input);
    expect(result).toContain('[REDACTED_PASSWORD]');
    expect(result).not.toContain('my-secret-pass');
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

  it('redacts multiple URL token params in a single URL', () => {
    const input = 'URL: https://api.example.com?token=abc123&api_key=def456&secret=ghi789';
    const result = sanitizePrompt(input);
    expect(result).toContain('token=[REDACTED]');
    expect(result).toContain('api_key=[REDACTED]');
    expect(result).toContain('secret=[REDACTED]');
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('def456');
    expect(result).not.toContain('ghi789');
  });
});
