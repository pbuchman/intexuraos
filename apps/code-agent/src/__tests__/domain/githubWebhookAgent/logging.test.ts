import { describe, it, expect } from 'vitest';
import {
  redactWebhookPayload,
  toBodyPreview,
  createStepContext,
  logStepFinish,
  BODY_PREVIEW_LIMIT,
  REDACTED_KEYS,
} from '../../../domain/githubWebhookAgent/logging.js';

describe('redactWebhookPayload', () => {
  it('redacts sensitive header values', () => {
    const payload = {
      headers: {
        'x-hub-signature-256': 'sha256=abc123secret',
        'x-hub-signature': 'sha1=oldsecret',
        authorization: 'Bearer token-value',
        'content-type': 'application/json',
      },
      body: { action: 'created' },
    };

    const redacted = redactWebhookPayload(payload);

    expect(redacted.headers['x-hub-signature-256']).toBe('[REDACTED]');
    expect(redacted.headers['x-hub-signature']).toBe('[REDACTED]');
    expect(redacted.headers['authorization']).toBe('[REDACTED]');
    expect(redacted.headers['content-type']).toBe('application/json');
  });

  it('redacts token fields in nested objects', () => {
    const payload = {
      installation: {
        id: 123,
        token: 'ghs_secret_token',
      },
      sender: { login: 'user1' },
    };

    const redacted = redactWebhookPayload(payload);

    expect(redacted.installation.token).toBe('[REDACTED]');
    expect(redacted.installation.id).toBe(123);
    expect(redacted.sender.login).toBe('user1');
  });

  it('handles null payload', () => {
    const redacted = redactWebhookPayload(null);
    expect(redacted).toBeNull();
  });

  it('handles payload without sensitive fields', () => {
    const payload = { action: 'opened', number: 42 };
    const redacted = redactWebhookPayload(payload);
    expect(redacted).toEqual(payload);
  });

  it('does not mutate original payload', () => {
    const payload = {
      headers: { authorization: 'Bearer secret' },
    };
    const original = JSON.parse(JSON.stringify(payload)) as typeof payload;
    redactWebhookPayload(payload);
    expect(payload).toEqual(original);
  });

  it('returns non-object payload unchanged', () => {
    expect(redactWebhookPayload('just a string')).toBe('just a string');
    expect(redactWebhookPayload(42)).toBe(42);
  });

  it('handles repeated redaction pass on already-masked payload', () => {
    const payload = {
      headers: { authorization: '[REDACTED]' },
    };
    const redacted = redactWebhookPayload(payload);
    expect(redacted.headers.authorization).toBe('[REDACTED]');
  });
});

describe('toBodyPreview', () => {
  it('returns full body when under limit', () => {
    const body = 'Short comment';
    expect(toBodyPreview(body)).toBe('Short comment');
  });

  it('truncates body exceeding preview limit', () => {
    const body = 'x'.repeat(BODY_PREVIEW_LIMIT + 100);
    const preview = toBodyPreview(body);

    expect(preview.length).toBeLessThanOrEqual(BODY_PREVIEW_LIMIT + 3);
    expect(preview.endsWith('...')).toBe(true);
  });

  it('is deterministic for the same input', () => {
    const body = 'a'.repeat(BODY_PREVIEW_LIMIT + 50);
    expect(toBodyPreview(body)).toBe(toBodyPreview(body));
  });

  it('returns empty string for null body', () => {
    expect(toBodyPreview(null)).toBe('');
  });

  it('returns empty string for undefined body', () => {
    expect(toBodyPreview(undefined)).toBe('');
  });

  it('handles unicode content correctly', () => {
    const body = '🎉'.repeat(BODY_PREVIEW_LIMIT);
    const preview = toBodyPreview(body);
    expect(preview.endsWith('...')).toBe(true);
    expect(preview.length).toBeGreaterThan(0);
  });
});

describe('createStepContext', () => {
  it('includes agent, runId, and step fields', () => {
    const ctx = createStepContext({
      runId: 'run-001',
      savedEventId: 'evt-123',
      step: 'acquire_lease',
    });

    expect(ctx.agent).toBe('GitHubWebhookAgent');
    expect(ctx.runId).toBe('run-001');
    expect(ctx.step).toBe('acquire_lease');
    expect(ctx.savedEventId).toBe('evt-123');
  });
});

describe('logStepFinish', () => {
  it('includes durationMs that is non-negative', () => {
    const startedAt = Date.now() - 150;
    const result = logStepFinish({
      runId: 'run-001',
      savedEventId: 'evt-123',
      step: 'plan',
      startedAt,
      outcome: 'success',
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.outcome).toBe('success');
    expect(result.agent).toBe('GitHubWebhookAgent');
    expect(result.step).toBe('plan');
  });

  it('handles error outcome', () => {
    const result = logStepFinish({
      runId: 'run-002',
      savedEventId: 'evt-456',
      step: 'execute',
      startedAt: Date.now() - 500,
      outcome: 'error',
      error: 'Validation failed',
    });

    expect(result.outcome).toBe('error');
    expect(result.error).toBe('Validation failed');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('computes zero duration when startedAt is now', () => {
    const result = logStepFinish({
      runId: 'run-003',
      savedEventId: 'evt-789',
      step: 'noop',
      startedAt: Date.now(),
      outcome: 'success',
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(100);
  });
});

describe('REDACTED_KEYS', () => {
  it('contains expected sensitive field names', () => {
    expect(REDACTED_KEYS).toContain('x-hub-signature-256');
    expect(REDACTED_KEYS).toContain('x-hub-signature');
    expect(REDACTED_KEYS).toContain('authorization');
    expect(REDACTED_KEYS).toContain('token');
    expect(REDACTED_KEYS).toContain('secret');
  });
});
