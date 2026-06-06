import { describe, expect, it } from 'vitest';
import {
  buildTaskCallbackUrl,
  deriveCallbackBaseUrl,
  normalizeInternalCallbackUrl,
} from '../callback-url.js';

describe('task callback URLs', () => {
  it('derives the canonical prod callback base from a task webhook URL', () => {
    expect(
      deriveCallbackBaseUrl(
        'https://intexuraos.cloud/internal/webhooks/task-complete',
        'http://localhost:8128'
      )
    ).toBe('https://intexuraos.cloud');
  });

  it('normalizes stale prod /api/code/internal callback URLs to canonical internal URLs', () => {
    expect(
      normalizeInternalCallbackUrl(
        'https://intexuraos.cloud/api/code/internal/webhooks/task-complete'
      )
    ).toBe('https://intexuraos.cloud/internal/webhooks/task-complete');
  });

  it.each([
    'logs',
    'turn-metrics',
    'webhooks/task-complete',
    'webhooks/task-event',
    'code-tasks/task-123/status',
  ])('normalizes recognized prod internal callback path %s', (path) => {
    expect(normalizeInternalCallbackUrl(`https://intexuraos.cloud/api/code/internal/${path}`)).toBe(
      `https://intexuraos.cloud/internal/${path}`
    );
  });

  it('does not normalize unrecognized prod internal callback paths', () => {
    expect(
      normalizeInternalCallbackUrl(
        'https://intexuraos.cloud/api/code/internal/not-a-worker-callback'
      )
    ).toBe('https://intexuraos.cloud/api/code/internal/not-a-worker-callback');
  });

  it('preserves dev callback URLs that legitimately include /api/code/internal', () => {
    expect(
      normalizeInternalCallbackUrl(
        'https://dev.intexuraos.cloud/api/code/internal/webhooks/task-complete'
      )
    ).toBe('https://dev.intexuraos.cloud/api/code/internal/webhooks/task-complete');
  });

  it('builds task-scoped internal callback URLs from the webhook base', () => {
    expect(
      buildTaskCallbackUrl(
        'https://intexuraos.cloud/internal/webhooks/task-complete',
        'http://localhost:8128',
        '/internal/logs'
      )
    ).toBe('https://intexuraos.cloud/internal/logs');
  });

  it('falls back to static code-agent URL when the task webhook URL is not usable', () => {
    expect(buildTaskCallbackUrl(undefined, 'http://localhost:8128/', '/internal/logs')).toBe(
      'http://localhost:8128/internal/logs'
    );
  });

  it('falls back when webhook URL has no internal marker', () => {
    expect(
      deriveCallbackBaseUrl(
        'https://intexuraos.cloud/webhooks/task-complete',
        'http://localhost:8128/'
      )
    ).toBe('http://localhost:8128');
  });

  it('falls back when webhook URL is malformed', () => {
    expect(deriveCallbackBaseUrl('not a url', 'http://localhost:8128/')).toBe(
      'http://localhost:8128'
    );
  });

  it('adds a leading slash to task callback paths', () => {
    expect(
      buildTaskCallbackUrl(
        'https://intexuraos.cloud/internal/webhooks/task-complete',
        'http://localhost:8128',
        'internal/turn-metrics'
      )
    ).toBe('https://intexuraos.cloud/internal/turn-metrics');
  });
});
