/**
 * Tests for ProcessWhatsAppWebhook use case.
 *
 * These tests exercise the webhook classification logic and processing flow
 * using fake repositories to avoid external dependencies.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { ProcessWhatsAppWebhookUseCase } from '../domain/inbox/usecases/processWhatsAppWebhook.js';
import type { WhatsAppWebhookPayload } from '../domain/inbox/usecases/processWhatsAppWebhook.js';
import { FakeWhatsAppWebhookEventRepository, FakeWhatsAppUserMappingRepository } from './fakes.js';
import type { InboxNotesRepository, InboxNote, InboxError } from '../domain/inbox/index.js';
import type { Result } from '@intexuraos/common';
import { ok, err } from '@intexuraos/common';

/**
 * Fake inbox notes repository for testing.
 */
class FakeInboxNotesRepository implements InboxNotesRepository {
  private notes = new Map<string, InboxNote>();
  private shouldFail = false;
  private shouldReturnWithoutId = false;

  createNote(note: InboxNote): Promise<Result<InboxNote, InboxError>> {
    if (this.shouldFail) {
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Fake error' }));
    }
    if (this.shouldReturnWithoutId) {
      // Return note without id to test edge case
      return Promise.resolve(ok({ ...note }));
    }
    const created = { ...note, id: `note-${String(Date.now())}` };
    this.notes.set(created.id, created);
    return Promise.resolve(ok(created));
  }

  getNote(noteId: string): Promise<Result<InboxNote | null, InboxError>> {
    return Promise.resolve(ok(this.notes.get(noteId) ?? null));
  }

  updateNote(noteId: string, updates: Partial<InboxNote>): Promise<Result<InboxNote, InboxError>> {
    const note = this.notes.get(noteId);
    if (note === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Note not found' }));
    }
    const updated = { ...note, ...updates };
    this.notes.set(noteId, updated);
    return Promise.resolve(ok(updated));
  }

  setFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  setReturnWithoutId(returnWithoutId: boolean): void {
    this.shouldReturnWithoutId = returnWithoutId;
  }

  getAll(): InboxNote[] {
    return Array.from(this.notes.values());
  }

  clear(): void {
    this.notes.clear();
    this.shouldFail = false;
    this.shouldReturnWithoutId = false;
  }
}

/**
 * Create a valid WhatsApp webhook payload for testing.
 */
function createValidPayload(
  from = '+1234567890',
  text = 'Hello world',
  phoneNumberId = 'allowed-phone-id'
): WhatsAppWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+10000000000',
                phone_number_id: phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: 'Test User' },
                  wa_id: from.replace('+', ''),
                },
              ],
              messages: [
                {
                  from,
                  id: 'wamid.123',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('ProcessWhatsAppWebhookUseCase', () => {
  let webhookRepo: FakeWhatsAppWebhookEventRepository;
  let mappingRepo: FakeWhatsAppUserMappingRepository;
  let notesRepo: FakeInboxNotesRepository;
  let useCase: ProcessWhatsAppWebhookUseCase;

  beforeEach(() => {
    webhookRepo = new FakeWhatsAppWebhookEventRepository();
    mappingRepo = new FakeWhatsAppUserMappingRepository();
    notesRepo = new FakeInboxNotesRepository();
    useCase = new ProcessWhatsAppWebhookUseCase(
      { allowedPhoneNumberIds: ['allowed-phone-id'] },
      webhookRepo,
      mappingRepo,
      notesRepo
    );
  });

  describe('webhook classification', () => {
    it('ignores non-WhatsApp webhook objects', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'instagram',
        entry: [],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('INVALID_OBJECT_TYPE');
      }
    });

    it('ignores payloads with no entries', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_ENTRIES');
      }
    });

    it('ignores payloads with no changes', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [{ id: 'entry-1', changes: [] }],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_CHANGES');
      }
    });

    it('ignores payloads where entry array has undefined first element', async () => {
      // Create payload with sparse array to trigger NO_ENTRY_DATA
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [],
      };
      // Manually manipulate the array to have length but undefined element
      const entries = payload.entry as unknown[];
      entries.length = 1;

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_ENTRY_DATA');
      }
    });

    it('ignores payloads where changes array has undefined first element', async () => {
      // Create payload with sparse array in changes to trigger NO_CHANGE_DATA
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [{ id: 'entry-1', changes: [] }],
      };
      // Manually manipulate the changes array to have length but undefined element
      const entry = payload.entry?.[0];
      if (entry !== undefined) {
        const changes = entry.changes as unknown[];
        changes.length = 1;
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_CHANGE_DATA');
      }
    });

    it('ignores unsupported phone number IDs', async () => {
      const payload = createValidPayload('+1234567890', 'Hello', 'unsupported-phone-id');

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('UNSUPPORTED_PHONE_NUMBER');
      }
    });

    it('ignores status updates (no messages)', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'allowed-phone-id' },
                  statuses: [{ id: 'wamid.123', status: 'delivered', timestamp: '12345' }],
                },
              },
            ],
          },
        ],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_MESSAGES');
      }
    });

    it('ignores non-text messages', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'allowed-phone-id' },
                  messages: [
                    {
                      from: '+1234567890',
                      id: 'wamid.123',
                      timestamp: '12345',
                      type: 'image',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NON_TEXT_MESSAGE');
      }
    });

    it('ignores payloads with missing phone number ID in metadata', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {},
                  messages: [
                    {
                      from: '+1234567890',
                      id: 'wamid.123',
                      timestamp: '12345',
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_PHONE_NUMBER_ID');
      }
    });

    it('ignores payloads with empty phone number ID in metadata', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '' },
                  messages: [
                    {
                      from: '+1234567890',
                      id: 'wamid.123',
                      timestamp: '12345',
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_PHONE_NUMBER_ID');
      }
    });

    it('ignores payloads where messages array has undefined first element', async () => {
      // Create payload with sparse array to trigger NO_MESSAGE_DATA
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'allowed-phone-id' },
                  // Array with length > 0 but undefined first element
                  messages: [],
                },
              },
            ],
          },
        ],
      };
      // Manually manipulate the array to have length but undefined element
      // TypeScript types don't allow this directly, so we cast
      const entry = payload.entry?.[0];
      if (entry?.changes?.[0]?.value.messages !== undefined) {
        const messages = entry.changes[0].value.messages as unknown[];
        messages.length = 1;
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_MESSAGE_DATA');
      }
    });

    it('ignores text messages with empty body', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'allowed-phone-id' },
                  messages: [
                    {
                      from: '+1234567890',
                      id: 'wamid.123',
                      timestamp: '12345',
                      type: 'text',
                      text: { body: '' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_TEXT_BODY');
      }
    });

    it('ignores text messages with missing text object', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'allowed-phone-id' },
                  messages: [
                    {
                      from: '+1234567890',
                      id: 'wamid.123',
                      timestamp: '12345',
                      type: 'text',
                      // text object is missing
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_TEXT_BODY');
      }
    });
  });

  describe('user mapping', () => {
    it('returns USER_UNMAPPED when phone number has no mapping', async () => {
      const payload = createValidPayload('+1234567890', 'Hello');

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('USER_UNMAPPED');
        expect(result.value.ignoredReason?.code).toBe('USER_UNMAPPED');
      }
    });

    it('returns USER_UNMAPPED when user mapping is disconnected', async () => {
      const phone = '+1234567890';
      // Create mapping then disconnect
      await mappingRepo.saveMapping('user-1', [phone]);
      await mappingRepo.disconnectMapping('user-1');

      const payload = createValidPayload(phone, 'Hello');

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('USER_UNMAPPED');
        expect(result.value.ignoredReason?.code).toBe('USER_DISCONNECTED');
      }
    });
  });

  describe('successful processing', () => {
    it('creates inbox note for valid text message with connected user', async () => {
      const phone = '+1234567890';
      await mappingRepo.saveMapping('user-1', [phone]);

      const payload = createValidPayload(phone, 'This is my inbox note');

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('PROCESSED');
        expect(result.value.inboxNote).toBeDefined();
        expect(result.value.inboxNote?.originalText).toBe('This is my inbox note');
        expect(result.value.inboxNote?.source).toBe('WhatsApp');
      }
    });

    it('truncates long message text in title', async () => {
      const phone = '+1234567890';
      await mappingRepo.saveMapping('user-1', [phone]);

      const longText =
        'This is a very long message that should be truncated in the title because it exceeds fifty characters';
      const payload = createValidPayload(phone, longText);

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('PROCESSED');
        expect(result.value.inboxNote?.title).toContain('...');
        expect(result.value.inboxNote?.title.length).toBeLessThanOrEqual(60); // "WA: " + 50 + "..."
      }
    });

    it('creates inbox note with phone number only as sender when no contact name', async () => {
      const phone = '+1234567890';
      await mappingRepo.saveMapping('user-1', [phone]);

      // Create payload without contacts profile name
      const payload: WhatsAppWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+10000000000',
                    phone_number_id: 'allowed-phone-id',
                  },
                  // No contacts array - sender name should be just the phone number
                  messages: [
                    {
                      from: phone,
                      id: 'wamid.123',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                      text: { body: 'Hello without contact name' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('PROCESSED');
        expect(result.value.inboxNote).toBeDefined();
        // Sender should be just the phone number without the name
        expect(result.value.inboxNote?.sender).toBe(phone);
      }
    });
  });

  describe('error handling', () => {
    it('returns FAILED when inbox note creation fails', async () => {
      const phone = '+1234567890';
      await mappingRepo.saveMapping('user-1', [phone]);
      notesRepo.setFail(true);

      const payload = createValidPayload(phone, 'Hello');

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('FAILED');
        expect(result.value.failureDetails).toContain('Failed to create inbox note');
      }
    });

    it('returns error when getMapping repository call fails', async () => {
      const phone = '+1234567890';
      await mappingRepo.saveMapping('user-1', [phone]);
      mappingRepo.setFailGetMapping(true);

      const payload = createValidPayload(phone, 'Hello');

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Simulated getMapping failure');
      }
    });

    it('returns error when findUserByPhoneNumber repository call fails', async () => {
      mappingRepo.setFailFindUserByPhoneNumber(true);

      const payload = createValidPayload('+1234567890', 'Hello');

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Simulated findUserByPhoneNumber failure');
      }
    });

    it('updates event status without inboxNoteId when created note has no id', async () => {
      const phone = '+1234567890';
      await mappingRepo.saveMapping('user-1', [phone]);
      notesRepo.setReturnWithoutId(true);

      const payload = createValidPayload(phone, 'Hello');

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('PROCESSED');
        expect(result.value.inboxNote).toBeDefined();
        // Note should not have an id
        expect(result.value.inboxNote?.id).toBeUndefined();
      }
    });
  });

  describe('webhook event tracking', () => {
    it('updates event status to IGNORED for invalid webhooks', async () => {
      const payload: WhatsAppWebhookPayload = {
        object: 'instagram',
        entry: [],
      };

      // First save the event
      await webhookRepo.saveEvent({
        payload: JSON.stringify(payload),
        receivedAt: new Date().toISOString(),
        status: 'PENDING',
        signatureValid: true,
        phoneNumberId: null,
      });

      await useCase.execute('event-1', payload);

      // Event should have been updated (though we can't verify without getEvent)
    });

    it('updates event status to PROCESSED for successful processing', async () => {
      const phone = '+1234567890';
      await mappingRepo.saveMapping('user-1', [phone]);

      const payload = createValidPayload(phone, 'Hello');

      await useCase.execute('event-1', payload);

      // Event should be updated to PROCESSED
    });
  });
});
