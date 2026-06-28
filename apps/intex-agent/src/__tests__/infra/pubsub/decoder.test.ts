import { describe, expect, it } from 'vitest';
import { decodeIntexMessageIngestPush } from '../../../infra/pubsub/decoder.js';

describe('decodeIntexMessageIngestPush', () => {
  it('decodes an intex.message.ingest Pub/Sub push payload', () => {
    const event = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-1',
      text: 'remember this',
      sourceType: 'whatsapp_text',
      whatsappSender: '+48123456789',
      timestamp: '2026-06-24T10:00:00.000Z',
    };

    expect(decodeIntexMessageIngestPush(push(event))).toEqual(event);
  });

  it('decodes messages without optional WhatsApp sender metadata', () => {
    const event = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-1',
      text: 'remember this',
      sourceType: 'whatsapp_text',
      timestamp: '2026-06-24T10:00:00.000Z',
    };

    expect(decodeIntexMessageIngestPush(push(event))).toEqual(event);
  });

  it('decodes optional replied-message context', () => {
    const event = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-1',
      text: 'show tomorrow calendar events',
      sourceType: 'whatsapp_text',
      timestamp: '2026-06-24T10:00:00.000Z',
      replyContext: {
        replyToWamid: 'wamid-original',
        source: 'outbound_assistant_message',
        text: 'What would you like me to help with?',
        truncated: false,
      },
    };

    expect(decodeIntexMessageIngestPush(push(event))).toEqual(event);
  });

  it('decodes inbound replied-message context', () => {
    const event = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-1',
      text: 'yes, that one',
      sourceType: 'whatsapp_text',
      timestamp: '2026-06-24T10:00:00.000Z',
      replyContext: {
        replyToWamid: 'wamid-original',
        source: 'inbound_user_message',
        text: 'Tomorrow morning please list my calendar events',
        truncated: true,
      },
    };

    expect(decodeIntexMessageIngestPush(push(event))).toEqual(event);
  });

  it('rejects malformed replied-message context', () => {
    const baseEvent = {
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-1',
      text: 'show tomorrow calendar events',
      sourceType: 'whatsapp_text',
      timestamp: '2026-06-24T10:00:00.000Z',
    };

    expect(() =>
      decodeIntexMessageIngestPush(push({ ...baseEvent, replyContext: null }))
    ).toThrow('Invalid intex.message.ingest event: replyContext must be an object');
    expect(() =>
      decodeIntexMessageIngestPush(push({ ...baseEvent, replyContext: [] }))
    ).toThrow('Invalid intex.message.ingest event: replyContext must be an object');
    expect(() =>
      decodeIntexMessageIngestPush(
        push({
          ...baseEvent,
          replyContext: {
            replyToWamid: 'wamid-original',
            source: 'assistant_message',
            text: 'What would you like me to help with?',
            truncated: false,
          },
        })
      )
    ).toThrow('Invalid intex.message.ingest event: replyContext.source is invalid');
    expect(() =>
      decodeIntexMessageIngestPush(
        push({
          ...baseEvent,
          replyContext: {
            replyToWamid: 'wamid-original',
            source: 'outbound_assistant_message',
            text: 'What would you like me to help with?',
            truncated: 'false',
          },
        })
      )
    ).toThrow('Invalid intex.message.ingest event: truncated must be a boolean');
  });

  it('rejects messages with another event type', () => {
    expect(() =>
      decodeIntexMessageIngestPush(push({ type: 'legacy.ingest', text: 'remember this' }))
    ).toThrow('Expected intex.message.ingest event');
  });

  it('rejects malformed base64 JSON', () => {
    expect(() =>
      decodeIntexMessageIngestPush({ message: { data: 'not-json', messageId: 'm1' } })
    ).toThrow('Invalid Pub/Sub message JSON');
  });

  it('rejects invalid Pub/Sub push envelopes', () => {
    expect(() => decodeIntexMessageIngestPush(null)).toThrow('Invalid Pub/Sub push body');
    expect(() => decodeIntexMessageIngestPush({ message: {} })).toThrow(
      'Invalid Pub/Sub push body'
    );
  });

  it('rejects non-object decoded events', () => {
    expect(() =>
      decodeIntexMessageIngestPush({
        message: { data: Buffer.from('null').toString('base64'), messageId: 'm1' },
      })
    ).toThrow('Invalid intex.message.ingest event');
    expect(() =>
      decodeIntexMessageIngestPush({
        message: { data: Buffer.from('"not-object"').toString('base64'), messageId: 'm1' },
      })
    ).toThrow('Invalid intex.message.ingest event');
  });

  it('rejects events with missing or invalid fields', () => {
    expect(() => decodeIntexMessageIngestPush(push({ text: 'remember this' }))).toThrow(
      'Expected intex.message.ingest event'
    );
    expect(() =>
      decodeIntexMessageIngestPush(
        push({
          type: 'intex.message.ingest',
          userId: '',
          messageId: 'wamid-1',
          text: 'remember this',
          sourceType: 'whatsapp_text',
          timestamp: '2026-06-24T10:00:00.000Z',
        })
      )
    ).toThrow('Invalid intex.message.ingest event: userId must be a string');
    expect(() =>
      decodeIntexMessageIngestPush(
        push({
          type: 'intex.message.ingest',
          userId: 'user-1',
          messageId: 'wamid-1',
          text: 'remember this',
          sourceType: 'whatsapp_text',
          whatsappSender: 123,
          timestamp: '2026-06-24T10:00:00.000Z',
        })
      )
    ).toThrow('Invalid intex.message.ingest event: whatsappSender must be a string');
  });
});

function push(event: Record<string, unknown>): unknown {
  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString('base64'),
      messageId: 'pubsub-1',
    },
    subscription: 'intex-message-ingest',
  };
}
