/**
 * Tests for NoopNotificationSender.
 */

import { describe, expect, it } from 'vitest';
import { NoopNotificationSender } from '../../../infra/notification/NoopNotificationSender.js';

describe('NoopNotificationSender', () => {
  it('returns success for sendResearchComplete', async () => {
    const sender = new NoopNotificationSender();

    const result = await sender.sendResearchComplete(
      'user-123',
      'research-456',
      'Test Title',
      'https://share.example.com/research.html'
    );

    expect(result.ok).toBe(true);
  });

  it('succeeds regardless of input for sendResearchComplete', async () => {
    const sender = new NoopNotificationSender();

    const result = await sender.sendResearchComplete('', '', '', '');

    expect(result.ok).toBe(true);
  });

  it('returns success for sendLlmFailure', async () => {
    const sender = new NoopNotificationSender();

    const result = await sender.sendLlmFailure('user-123', 'research-456', 'google', 'API Error');

    expect(result.ok).toBe(true);
  });

  it('succeeds regardless of input for sendLlmFailure', async () => {
    const sender = new NoopNotificationSender();

    const result = await sender.sendLlmFailure('', '', 'openai', '');

    expect(result.ok).toBe(true);
  });
});
