import { describe, expect, it } from 'vitest';
import { decodePubSubMessage } from '../../../infra/pubsub/decoder.js';

interface TestEvent {
  type: string;
  userId: string;
  externalId: string;
}

describe('decodePubSubMessage', () => {
  it('decodes valid base64 JSON message', () => {
    const event = { type: 'test.event', userId: 'user-123', externalId: 'ext-456' };
    const base64Data = Buffer.from(JSON.stringify(event)).toString('base64');

    const result = decodePubSubMessage<TestEvent>(base64Data);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(event);
    }
  });

  it('returns error for invalid base64', () => {
    const result = decodePubSubMessage<TestEvent>('not-valid-base64!!!');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to decode PubSub message');
    }
  });

  it('returns error for invalid JSON after successful base64 decode', () => {
    const base64Data = Buffer.from('not-json').toString('base64');

    const result = decodePubSubMessage<TestEvent>(base64Data);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to decode PubSub message');
    }
  });

  it('handles empty string', () => {
    const result = decodePubSubMessage<TestEvent>('');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to decode PubSub message');
    }
  });

  it('correctly parses complex nested objects', () => {
    const event = {
      type: 'command.ingest',
      userId: 'user-123',
      sourceType: 'whatsapp_text',
      externalId: 'ext-456',
      text: 'Hello world',
      summary: 'A greeting',
      timestamp: '2024-01-15T10:30:00Z',
    };
    const base64Data = Buffer.from(JSON.stringify(event)).toString('base64');

    const result = decodePubSubMessage<typeof event>(base64Data);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(event);
    }
  });
});
