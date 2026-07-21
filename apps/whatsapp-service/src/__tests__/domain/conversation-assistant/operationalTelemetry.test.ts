import { describe, expect, it, vi } from 'vitest';
import {
  recordConversationAssistantTelemetry,
} from '../../../domain/conversation-assistant/operationalTelemetry.js';

describe('Conversation Assistant telemetry boundary', () => {
  it('records a content-free aggregate when telemetry is configured', async () => {
    const record = vi.fn().mockResolvedValue(undefined);

    await recordConversationAssistantTelemetry(
      { record },
      {
        operation: 'attachment_preparation',
        outcome: 'ready',
        durationMs: 12.5,
        estimatedBytes: 4096,
        count: 7,
      }
    );

    expect(record).toHaveBeenCalledWith({
      operation: 'attachment_preparation',
      outcome: 'ready',
      durationMs: 12.5,
      estimatedBytes: 4096,
      count: 7,
    });
  });

  it('is a no-op when telemetry is not configured', async () => {
    await expect(
      recordConversationAssistantTelemetry(undefined, {
        operation: 'session_cleanup',
        outcome: 'completed',
      })
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      name: 'asynchronously rejects',
      record: vi.fn().mockRejectedValue(new Error('metrics unavailable')),
    },
    {
      name: 'synchronously throws',
      record: vi.fn(() => {
        throw new Error('metrics unavailable');
      }),
    },
  ])('isolates a telemetry adapter that $name', async ({ record }) => {
    await expect(
      recordConversationAssistantTelemetry({ record }, {
        operation: 'pdf_revision',
        outcome: 'completed',
        count: 3,
      })
    ).resolves.toBeUndefined();
  });
});
