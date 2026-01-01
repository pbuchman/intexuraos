/**
 * Tests for NoopNotificationSender.
 */

import { describe, expect, it } from 'vitest';
import { NoopNotificationSender } from '../../../infra/notification/NoopNotificationSender.js';

describe('NoopNotificationSender', () => {
  it('returns success without doing anything', async () => {
    const sender = new NoopNotificationSender();

    const result = await sender.sendResearchComplete('user-123', 'research-456', 'Test Title');

    expect(result.ok).toBe(true);
  });

  it('succeeds regardless of input', async () => {
    const sender = new NoopNotificationSender();

    const result = await sender.sendResearchComplete('', '', '');

    expect(result.ok).toBe(true);
  });
});
