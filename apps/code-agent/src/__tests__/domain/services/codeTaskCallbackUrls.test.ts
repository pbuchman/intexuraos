import { describe, expect, it } from 'vitest';
import {
  buildInternalCallbackUrl,
  classifyCallbackOwner,
  buildTaskCompleteWebhookUrl,
  buildTaskEventWebhookUrl,
  normalizeCallbackBaseUrl,
} from '../../../domain/services/codeTaskCallbackUrls.js';

describe('code task callback URLs', () => {
  it('builds routable prod callback URLs through the public code-agent API prefix', () => {
    expect(buildTaskCompleteWebhookUrl('https://intexuraos.cloud/')).toBe(
      'https://intexuraos.cloud/api/code/internal/webhooks/task-complete'
    );
    expect(buildTaskEventWebhookUrl('https://intexuraos.cloud')).toBe(
      'https://intexuraos.cloud/api/code/internal/webhooks/task-event'
    );
  });

  it('builds routable dev callback URLs through the public code-agent API prefix', () => {
    expect(buildTaskCompleteWebhookUrl('https://dev.intexuraos.cloud')).toBe(
      'https://dev.intexuraos.cloud/api/code/internal/webhooks/task-complete'
    );
  });

  it('preserves already-canonical public callback bases', () => {
    expect(
      buildInternalCallbackUrl('https://intexuraos.cloud/api/code/', '/internal/logs')
    ).toBe('https://intexuraos.cloud/api/code/internal/logs');
  });

  it('preserves public callback bases with explicit non-code-agent paths', () => {
    expect(
      buildInternalCallbackUrl('https://intexuraos.cloud/custom-callbacks/', '/internal/logs')
    ).toBe('https://intexuraos.cloud/custom-callbacks/internal/logs');
  });

  it('adds a leading slash when building callback paths', () => {
    expect(
      buildInternalCallbackUrl('https://callback.test', 'internal/logs')
    ).toBe('https://callback.test/internal/logs');
  });

  it('preserves localhost direct internal callback URLs', () => {
    expect(buildTaskCompleteWebhookUrl('http://localhost:8128')).toBe(
      'http://localhost:8128/internal/webhooks/task-complete'
    );
  });

  it('classifies callback ownership from normalized callback bases', () => {
    expect(classifyCallbackOwner(normalizeCallbackBaseUrl('https://dev.intexuraos.cloud'))).toBe('dev');
    expect(classifyCallbackOwner(normalizeCallbackBaseUrl('https://intexuraos.cloud'))).toBe('prod');
    expect(classifyCallbackOwner('https://callback.test')).toBe('custom');
  });
});
