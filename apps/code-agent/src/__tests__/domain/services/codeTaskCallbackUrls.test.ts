import { describe, expect, it } from 'vitest';
import {
  buildInternalCallbackUrl,
  buildTaskCompleteWebhookUrl,
  buildTaskEventWebhookUrl,
} from '../../../domain/services/codeTaskCallbackUrls.js';

describe('code task callback URLs', () => {
  it('builds canonical prod internal callback URLs without the public API prefix', () => {
    const baseUrl = 'https://intexuraos.cloud/';

    expect(buildTaskCompleteWebhookUrl(baseUrl)).toBe(
      'https://intexuraos.cloud/internal/webhooks/task-complete'
    );
    expect(buildTaskEventWebhookUrl(baseUrl)).toBe(
      'https://intexuraos.cloud/internal/webhooks/task-event'
    );
  });

  it('preserves dev callback base paths when the ingress still uses /api/code', () => {
    expect(
      buildInternalCallbackUrl('https://dev.intexuraos.cloud/api/code/', '/internal/logs')
    ).toBe('https://dev.intexuraos.cloud/api/code/internal/logs');
  });

  it('adds a leading slash when building callback paths', () => {
    expect(
      buildInternalCallbackUrl('https://intexuraos.cloud', 'internal/logs')
    ).toBe('https://intexuraos.cloud/internal/logs');
  });

  it('rejects prod callback URLs that would target /api/code/internal', () => {
    expect(() =>
      buildTaskCompleteWebhookUrl('https://intexuraos.cloud/api/code')
    ).toThrow('/api/code/internal');
  });
});
