/**
 * Tests for shared utilities in whatsapp-service.
 */
import { describe, expect, it } from 'vitest';
import {
  extractAudioMedia,
  extractDisplayPhoneNumber,
  extractImageMedia,
  extractMessageId,
  extractMessageText,
  extractMessageTimestamp,
  extractMessageType,
  extractPhoneNumberId,
  extractSenderName,
  extractSenderPhoneNumber,
  extractWabaId,
  getSupportedCountries,
  normalizePhoneNumber,
  validatePhoneNumber,
} from '../routes/shared.js';

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

    it('removes all non-digit characters', () => {
      expect(normalizePhoneNumber('+1 (555) 123-4567')).toBe('15551234567');
      expect(normalizePhoneNumber('+48 123 456 789')).toBe('48123456789');
    });

    it('removes plus signs anywhere in the string', () => {
      expect(normalizePhoneNumber('+1+2+3')).toBe('123');
    });

    it('ensures stored +48XX matches webhook 48XX', () => {
      // User saves +48123456789 in UI
      const storedNumber = normalizePhoneNumber('+48123456789');
      // Webhook sends 48123456789 (no +)
      const webhookNumber = normalizePhoneNumber('48123456789');
      // Both should normalize to the same value
      expect(storedNumber).toBe(webhookNumber);
      expect(storedNumber).toBe('48123456789');
    });
  });

  describe('getSupportedCountries', () => {
    it('returns PL and US as first two entries', () => {
      const countries = getSupportedCountries();
      expect(countries[0]?.country).toBe('PL');
      expect(countries[1]?.country).toBe('US');
    });

    it('includes calling codes', () => {
      const countries = getSupportedCountries();
      const pl = countries.find((c) => c.country === 'PL');
      const us = countries.find((c) => c.country === 'US');
      expect(pl?.callingCode).toBe('48');
      expect(us?.callingCode).toBe('1');
    });

    it('returns many countries', () => {
      const countries = getSupportedCountries();
      // libphonenumber-js has 200+ countries
      expect(countries.length).toBeGreaterThan(100);
    });
  });

  describe('validatePhoneNumber', () => {
    describe('Poland (+48)', () => {
      it('accepts valid Polish phone number with +', () => {
        const result = validatePhoneNumber('+48123456789');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('48123456789');
        expect(result.country).toBe('PL');
      });

      it('accepts valid Polish phone number without +', () => {
        const result = validatePhoneNumber('48123456789');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('48123456789');
        expect(result.country).toBe('PL');
      });

      it('accepts Polish phone number with spaces', () => {
        const result = validatePhoneNumber('+48 123 456 789');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('48123456789');
        expect(result.country).toBe('PL');
      });

      it('rejects Polish phone number starting with 0', () => {
        const result = validatePhoneNumber('+48012345678');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid');
      });

      it('rejects Polish phone number with wrong length', () => {
        const result = validatePhoneNumber('+4812345678'); // 8 digits
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid');
      });
    });

    describe('USA (+1)', () => {
      it('accepts valid US phone number with +', () => {
        const result = validatePhoneNumber('+12125551234');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('12125551234');
        expect(result.country).toBe('US');
      });

      it('accepts valid US phone number without +', () => {
        const result = validatePhoneNumber('12125551234');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('12125551234');
        expect(result.country).toBe('US');
      });

      it('accepts US phone number with formatting', () => {
        const result = validatePhoneNumber('+1 (212) 555-4567');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('12125554567');
        expect(result.country).toBe('US');
      });

      it('rejects US phone number starting with 0 or 1', () => {
        const result = validatePhoneNumber('+10125551234');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid');
      });

      it('rejects US phone number with wrong length', () => {
        const result = validatePhoneNumber('+1212555123'); // 9 digits
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid');
      });
    });

    describe('other countries', () => {
      it('accepts UK phone number', () => {
        const result = validatePhoneNumber('+442071234567');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('442071234567');
        expect(result.country).toBe('GB');
      });

      it('accepts German phone number', () => {
        const result = validatePhoneNumber('+4915112345678');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('4915112345678');
        expect(result.country).toBe('DE');
      });

      it('accepts French phone number', () => {
        const result = validatePhoneNumber('+33612345678');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('33612345678');
        expect(result.country).toBe('FR');
      });

      it('accepts valid international premium rate number without country', () => {
        // +979 is International Premium Rate service, which parses as valid but has no country
        const result = validatePhoneNumber('+979123456789');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('979123456789');
        expect(result.country).toBeUndefined();
      });
    });

    describe('edge cases', () => {
      it('rejects empty string', () => {
        const result = validatePhoneNumber('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('required');
      });

      it('rejects whitespace only', () => {
        const result = validatePhoneNumber('   ');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('required');
      });

      it('rejects invalid number', () => {
        const result = validatePhoneNumber('+1234');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid');
      });

      it('rejects non-numeric input that causes parse error', () => {
        // Input like "+abc" causes parsePhoneNumberWithError to throw NOT_A_NUMBER
        const result = validatePhoneNumber('+abc');
        expect(result.valid).toBe(false);
        expect(result.normalized).toBe(''); // Only digits remain after normalization
        expect(result.error).toContain('Invalid');
      });
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

    it('returns null when messages array is empty', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [] } }] }],
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

    it('returns null when messages array is empty', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [] } }] }],
      };
      expect(extractMessageType(payload)).toBeNull();
    });
  });

  describe('extractImageMedia', () => {
    it('extracts image media info', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      type: 'image',
                      image: {
                        id: 'media-123',
                        mime_type: 'image/jpeg',
                        sha256: 'abc123',
                        caption: 'Test caption',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const result = extractImageMedia(payload);
      expect(result).toEqual({
        id: 'media-123',
        mimeType: 'image/jpeg',
        sha256: 'abc123',
        caption: 'Test caption',
      });
    });

    it('returns image media without optional fields', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      type: 'image',
                      image: {
                        id: 'media-123',
                        mime_type: 'image/png',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const result = extractImageMedia(payload);
      expect(result).toEqual({
        id: 'media-123',
        mimeType: 'image/png',
      });
    });

    it('returns null when image is not present', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ type: 'text' }] } }] }],
      };
      expect(extractImageMedia(payload)).toBeNull();
    });

    it('returns null when image id is missing', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ type: 'image', image: { mime_type: 'image/jpeg' } }],
                },
              },
            ],
          },
        ],
      };
      expect(extractImageMedia(payload)).toBeNull();
    });

    it('returns null when mime_type is missing', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ type: 'image', image: { id: 'media-123' } }],
                },
              },
            ],
          },
        ],
      };
      expect(extractImageMedia(payload)).toBeNull();
    });

    it('returns null when messages array is empty', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [] } }] }],
      };
      expect(extractImageMedia(payload)).toBeNull();
    });
  });

  describe('extractAudioMedia', () => {
    it('extracts audio media info', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      type: 'audio',
                      audio: {
                        id: 'audio-123',
                        mime_type: 'audio/ogg',
                        sha256: 'def456',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const result = extractAudioMedia(payload);
      expect(result).toEqual({
        id: 'audio-123',
        mimeType: 'audio/ogg',
        sha256: 'def456',
      });
    });

    it('returns audio media without optional sha256', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      type: 'audio',
                      audio: {
                        id: 'audio-123',
                        mime_type: 'audio/mpeg',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const result = extractAudioMedia(payload);
      expect(result).toEqual({
        id: 'audio-123',
        mimeType: 'audio/mpeg',
      });
    });

    it('returns null when audio is not present', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [{ type: 'text' }] } }] }],
      };
      expect(extractAudioMedia(payload)).toBeNull();
    });

    it('returns null when audio id is missing', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ type: 'audio', audio: { mime_type: 'audio/ogg' } }],
                },
              },
            ],
          },
        ],
      };
      expect(extractAudioMedia(payload)).toBeNull();
    });

    it('returns null when mime_type is missing', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ type: 'audio', audio: { id: 'audio-123' } }],
                },
              },
            ],
          },
        ],
      };
      expect(extractAudioMedia(payload)).toBeNull();
    });

    it('returns null when messages array is empty', () => {
      const payload = {
        entry: [{ changes: [{ value: { messages: [] } }] }],
      };
      expect(extractAudioMedia(payload)).toBeNull();
    });
  });
});
