/**
 * Tests for shared utilities in whatsapp-service.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import {
  handleValidationError,
  normalizePhoneNumber,
  extractWabaId,
  extractPhoneNumberId,
  extractDisplayPhoneNumber,
  extractSenderPhoneNumber,
  extractMessageId,
  extractMessageText,
  extractMessageTimestamp,
  extractSenderName,
  extractMessageType,
} from '../routes/v1/shared.js';

describe('shared utilities', () => {
  describe('normalizePhoneNumber', () => {
    it('removes leading + from phone number', () => {
      expect(normalizePhoneNumber('+15551234567')).toBe('15551234567');
    });

    it('returns unchanged if no leading +', () => {
      expect(normalizePhoneNumber('15551234567')).toBe('15551234567');
    });

    it('handles empty string', () => {
      expect(normalizePhoneNumber('')).toBe('');
    });

    it('only removes leading +', () => {
      expect(normalizePhoneNumber('+1+2+3')).toBe('1+2+3');
    });
  });

  describe('handleValidationError', () => {
    it('converts Zod error to API error response', () => {
      const schema = z.object({
        phoneNumbers: z.array(z.string().min(1)).min(1, 'At least one phone number required'),
      });

      const result = schema.safeParse({ phoneNumbers: [] });
      expect(result.success).toBe(false);

      if (!result.success) {
        const mockFail = vi.fn().mockReturnThis();
        const mockReply = {
          fail: mockFail,
        } as unknown as FastifyReply;

        handleValidationError(result.error, mockReply);

        expect(mockFail).toHaveBeenCalledTimes(1);
        const callArgs = mockFail.mock.calls[0] as unknown[];
        expect(callArgs[0]).toBe('INVALID_REQUEST');
        expect(callArgs[1]).toBe('Validation failed');
      }
    });
  });

  describe('extractWabaId', () => {
    it('extracts WABA ID from valid webhook payload', () => {
      const payload = {
        entry: [
          {
            id: '102290129340398',
            changes: [{ value: {} }],
          },
        ],
      };

      expect(extractWabaId(payload)).toBe('102290129340398');
    });

    it('returns null for null payload', () => {
      expect(extractWabaId(null)).toBeNull();
    });

    it('returns null for payload without entry', () => {
      expect(extractWabaId({})).toBeNull();
    });

    it('returns null for payload with empty entry array', () => {
      expect(extractWabaId({ entry: [] })).toBeNull();
    });

    it('returns null when entry has no id', () => {
      expect(extractWabaId({ entry: [{ changes: [] }] })).toBeNull();
    });
  });

  describe('extractPhoneNumberId', () => {
    it('extracts phone number ID from valid webhook payload', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: {
                    phone_number_id: '123456789',
                  },
                },
              },
            ],
          },
        ],
      };

      expect(extractPhoneNumberId(payload)).toBe('123456789');
    });

    it('returns null for null payload', () => {
      expect(extractPhoneNumberId(null)).toBeNull();
    });

    it('returns null for payload without entry', () => {
      expect(extractPhoneNumberId({})).toBeNull();
    });

    it('returns null for payload with empty entry array', () => {
      expect(extractPhoneNumberId({ entry: [] })).toBeNull();
    });

    it('returns null when entry has no changes', () => {
      expect(extractPhoneNumberId({ entry: [{}] })).toBeNull();
    });

    it('returns null when changes is empty', () => {
      expect(extractPhoneNumberId({ entry: [{ changes: [] }] })).toBeNull();
    });

    it('returns null when change has no value', () => {
      expect(extractPhoneNumberId({ entry: [{ changes: [{}] }] })).toBeNull();
    });

    it('returns null when value is null', () => {
      expect(extractPhoneNumberId({ entry: [{ changes: [{ value: null }] }] })).toBeNull();
    });

    it('returns null when value has no metadata', () => {
      expect(extractPhoneNumberId({ entry: [{ changes: [{ value: {} }] }] })).toBeNull();
    });

    it('returns null when metadata has no phone_number_id', () => {
      const payload = {
        entry: [{ changes: [{ value: { metadata: {} } }] }],
      };
      expect(extractPhoneNumberId(payload)).toBeNull();
    });
  });

  describe('extractDisplayPhoneNumber', () => {
    it('extracts display phone number from valid webhook payload', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: {
                    display_phone_number: '15551381846',
                  },
                },
              },
            ],
          },
        ],
      };

      expect(extractDisplayPhoneNumber(payload)).toBe('15551381846');
    });

    it('returns null for null payload', () => {
      expect(extractDisplayPhoneNumber(null)).toBeNull();
    });

    it('returns null for payload without entry', () => {
      expect(extractDisplayPhoneNumber({})).toBeNull();
    });

    it('returns null when metadata has no display_phone_number', () => {
      const payload = {
        entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' } } }] }],
      };
      expect(extractDisplayPhoneNumber(payload)).toBeNull();
    });
  });

  describe('extractSenderPhoneNumber', () => {
    it('extracts sender phone number from valid webhook payload', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ from: '+15551234567' }],
                },
              },
            ],
          },
        ],
      };

      expect(extractSenderPhoneNumber(payload)).toBe('+15551234567');
    });

    it('returns null for null payload', () => {
      expect(extractSenderPhoneNumber(null)).toBeNull();
    });

    it('returns null for payload without entry', () => {
      expect(extractSenderPhoneNumber({})).toBeNull();
    });

    it('returns null for payload with empty entry array', () => {
      expect(extractSenderPhoneNumber({ entry: [] })).toBeNull();
    });

    it('returns null when entry has no changes', () => {
      expect(extractSenderPhoneNumber({ entry: [{}] })).toBeNull();
    });

    it('returns null when changes is empty', () => {
      expect(extractSenderPhoneNumber({ entry: [{ changes: [] }] })).toBeNull();
    });

    it('returns null when change has no value', () => {
      expect(extractSenderPhoneNumber({ entry: [{ changes: [{}] }] })).toBeNull();
    });

    it('returns null when value is null', () => {
      expect(extractSenderPhoneNumber({ entry: [{ changes: [{ value: null }] }] })).toBeNull();
    });

    it('returns null when value has no messages', () => {
      expect(extractSenderPhoneNumber({ entry: [{ changes: [{ value: {} }] }] })).toBeNull();
    });

    it('returns null when messages is empty array', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [] } }] }],
      };
      expect(extractSenderPhoneNumber(payload)).toBeNull();
    });

    it('returns null when message has no from field', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{}] } }] }],
      };
      expect(extractSenderPhoneNumber(payload)).toBeNull();
    });

    it('returns null when from is not a string', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ from: 12345 }] } }] }],
      };
      expect(extractSenderPhoneNumber(payload)).toBeNull();
    });
  });

  describe('extractMessageId', () => {
    it('extracts message ID from valid webhook payload', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ id: 'wamid.XXXX' }],
                },
              },
            ],
          },
        ],
      };

      expect(extractMessageId(payload)).toBe('wamid.XXXX');
    });

    it('returns null for null payload', () => {
      expect(extractMessageId(null)).toBeNull();
    });

    it('returns null for payload without entry', () => {
      expect(extractMessageId({})).toBeNull();
    });

    it('returns null for payload with empty entry array', () => {
      expect(extractMessageId({ entry: [] })).toBeNull();
    });

    it('returns null when entry has no changes', () => {
      expect(extractMessageId({ entry: [{}] })).toBeNull();
    });

    it('returns null when changes is empty', () => {
      expect(extractMessageId({ entry: [{ changes: [] }] })).toBeNull();
    });

    it('returns null when change has no value', () => {
      expect(extractMessageId({ entry: [{ changes: [{}] }] })).toBeNull();
    });

    it('returns null when value is null', () => {
      expect(extractMessageId({ entry: [{ changes: [{ value: null }] }] })).toBeNull();
    });

    it('returns null when value has no messages', () => {
      expect(extractMessageId({ entry: [{ changes: [{ value: {} }] }] })).toBeNull();
    });

    it('returns null when messages is empty array', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [] } }] }],
      };
      expect(extractMessageId(payload)).toBeNull();
    });

    it('returns null when message has no id field', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ from: '+1234' }] } }] }],
      };
      expect(extractMessageId(payload)).toBeNull();
    });

    it('returns null when id is not a string', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ id: 12345 }] } }] }],
      };
      expect(extractMessageId(payload)).toBeNull();
    });
  });

  describe('extractMessageText', () => {
    it('extracts text body from valid message', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ text: { body: 'Hello world!' } }],
                },
              },
            ],
          },
        ],
      };
      expect(extractMessageText(payload)).toBe('Hello world!');
    });

    it('returns null for message without text', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ type: 'image' }] } }] }],
      };
      expect(extractMessageText(payload)).toBeNull();
    });

    it('returns null for null payload', () => {
      expect(extractMessageText(null)).toBeNull();
    });
  });

  describe('extractMessageTimestamp', () => {
    it('extracts timestamp from valid message', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ timestamp: '1234567890' }],
                },
              },
            ],
          },
        ],
      };
      expect(extractMessageTimestamp(payload)).toBe('1234567890');
    });

    it('returns null for message without timestamp', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ id: 'test' }] } }] }],
      };
      expect(extractMessageTimestamp(payload)).toBeNull();
    });
  });

  describe('extractSenderName', () => {
    it('extracts sender name from contacts', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: 'John Doe' } }],
                },
              },
            ],
          },
        ],
      };
      expect(extractSenderName(payload)).toBe('John Doe');
    });

    it('returns null when contacts not present', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [] } }] }],
      };
      expect(extractSenderName(payload)).toBeNull();
    });

    it('returns null when profile name not present', () => {
      const payload = {
        entry: [{ changes: [{ value: { contacts: [{}] } }] }],
      };
      expect(extractSenderName(payload)).toBeNull();
    });
  });

  describe('extractMessageType', () => {
    it('extracts message type', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ type: 'text' }],
                },
              },
            ],
          },
        ],
      };
      expect(extractMessageType(payload)).toBe('text');
    });

    it('returns null for message without type', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ id: 'test' }] } }] }],
      };
      expect(extractMessageType(payload)).toBeNull();
    });

    it('returns null for non-string type', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ type: 123 }] } }] }],
      };
      expect(extractMessageType(payload)).toBeNull();
    });
  });
});
