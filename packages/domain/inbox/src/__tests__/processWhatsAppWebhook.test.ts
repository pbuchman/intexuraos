/**
 * Tests for ProcessWhatsAppWebhookUseCase.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err } from '@praxos/common';
import { ProcessWhatsAppWebhookUseCase, type WhatsAppWebhookPayload } from '../usecases/processWhatsAppWebhook.js';
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppUserMappingRepository,
  InboxNotesRepository,
} from '../ports/repositories.js';
import type { InboxNote, InboxError } from '../models/InboxNote.js';

describe('ProcessWhatsAppWebhookUseCase', () => {
  let useCase: ProcessWhatsAppWebhookUseCase;
  let webhookRepo: WhatsAppWebhookEventRepository;
  let mappingRepo: WhatsAppUserMappingRepository;
  let notesRepo: InboxNotesRepository;

  const testConfig = {
    allowedPhoneNumberIds: ['123456789012345'],
  };

  function createValidPayload(): WhatsAppWebhookPayload {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_ID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1234567890',
                  phone_number_id: '123456789012345',
                },
                contacts: [
                  {
                    profile: {
                      name: 'Test User',
                    },
                    wa_id: '15551234567',
                  },
                ],
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid.HBgNMTU1NTEyMzQ1Njc4FQIAEhgUM0VCMDRBNzYwREQ0RjMwMjYzMDcA',
                    timestamp: '1234567890',
                    type: 'text',
                    text: {
                      body: 'Hello, World!',
                    },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
  }

  beforeEach((): void => {
    // Create mock repositories
    webhookRepo = {
      saveEvent: async () =>
        ok({
          id: 'event-1',
          payload: {},
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId: '123456789012345',
          status: 'PENDING',
        }),
      updateEventStatus: async () =>
        ok({
          id: 'event-1',
          payload: {},
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId: '123456789012345',
          status: 'PROCESSED',
        }),
      getEvent: async () =>
        ok({
          id: 'event-1',
          payload: {},
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId: '123456789012345',
          status: 'PENDING',
        }),
    };

    mappingRepo = {
      saveMapping: async () =>
        ok({
          phoneNumbers: ['15551234567'],
          inboxNotesDbId: 'notion-db-id',
          connected: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      getMapping: async () =>
        ok({
          phoneNumbers: ['15551234567'],
          inboxNotesDbId: 'notion-db-id',
          connected: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      findUserByPhoneNumber: async () => ok('user-1'),
      disconnectMapping: async () =>
        ok({
          phoneNumbers: ['15551234567'],
          inboxNotesDbId: 'notion-db-id',
          connected: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      isConnected: async () => ok(true),
    };

    const sampleNote: InboxNote = {
      title: 'Sample Note',
      status: 'Inbox',
      source: 'WhatsApp',
      messageType: 'Text',
      contentType: 'Other',
      topics: [],
      originalText: 'Sample text',
      capturedAt: new Date().toISOString(),
      sender: 'Test User',
      externalId: 'msg-123',
      processedBy: 'None',
    };

    notesRepo = {
      createNote: async (note: InboxNote) => ok({ ...note, id: 'note-1' }),
      getNote: async () => ok(null),
      updateNote: async (noteId: string, updates: Partial<InboxNote>) =>
        ok({ ...sampleNote, id: noteId, ...updates }),
    };

    useCase = new ProcessWhatsAppWebhookUseCase(testConfig, webhookRepo, mappingRepo, notesRepo);
  });

  describe('valid text message processing', () => {
    it('processes valid webhook and creates inbox note', async (): Promise<void> => {
      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('PROCESSED');
        expect(result.value.inboxNote).toBeDefined();
        expect(result.value.inboxNote?.title).toContain('WA:');
        expect(result.value.inboxNote?.originalText).toBe('Hello, World!');
        expect(result.value.inboxNote?.source).toBe('WhatsApp');
        expect(result.value.inboxNote?.messageType).toBe('Text');
      }
    });

    it('creates title from message text', async (): Promise<void> => {
      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok && result.value.inboxNote !== undefined) {
        expect(result.value.inboxNote.title).toBe('WA: Hello, World!');
      }
    });

    it('truncates long messages in title', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value.messages?.[0]?.text !== undefined) {
        payload.entry[0].changes[0].value.messages[0].text.body =
          'This is a very long message that should be truncated to 50 characters';
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok && result.value.inboxNote !== undefined) {
        expect(result.value.inboxNote.title).toBe(
          'WA: This is a very long message that should be truncat...'
        );
      }
    });

    it('includes sender name in sender field', async (): Promise<void> => {
      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok && result.value.inboxNote !== undefined) {
        expect(result.value.inboxNote.sender).toBe('Test User (15551234567)');
      }
    });

    it('uses phone number if no sender name', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value.contacts?.[0] !== undefined) {
        delete payload.entry[0].changes[0].value.contacts[0].profile;
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok && result.value.inboxNote !== undefined) {
        expect(result.value.inboxNote.sender).toBe('15551234567');
      }
    });

    it('converts timestamp to ISO date', async (): Promise<void> => {
      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok && result.value.inboxNote !== undefined) {
        const capturedDate = new Date(result.value.inboxNote.capturedAt);
        expect(capturedDate.toISOString()).toBe(new Date(1234567890 * 1000).toISOString());
      }
    });
  });

  describe('webhook classification - ignored cases', () => {
    it('ignores non-whatsapp_business_account objects', async (): Promise<void> => {
      const payload = createValidPayload();
      payload.object = 'instagram_account';

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('INVALID_OBJECT_TYPE');
      }
    });

    it('ignores webhook with no entries', async (): Promise<void> => {
      const payload = createValidPayload();
      payload.entry = [];

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_ENTRIES');
      }
    });

    it('ignores webhook with undefined entries', async (): Promise<void> => {
      const payload = createValidPayload();
      delete payload.entry;

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_ENTRIES');
      }
    });

    it('ignores entry with no changes', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0] !== undefined) {
        payload.entry[0].changes = [];
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_CHANGES');
      }
    });

    it('ignores unsupported phone number ID', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value.metadata !== undefined) {
        payload.entry[0].changes[0].value.metadata.phone_number_id = '999999999';
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('UNSUPPORTED_PHONE_NUMBER');
        expect(result.value.ignoredReason?.details).toEqual({
          phoneNumberId: '999999999',
          allowed: ['123456789012345'],
        });
      }
    });

    it('ignores webhook with no phone number ID', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value.metadata !== undefined) {
        delete payload.entry[0].changes[0].value.metadata.phone_number_id;
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_PHONE_NUMBER_ID');
      }
    });

    it('ignores webhook with empty phone number ID', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value.metadata !== undefined) {
        payload.entry[0].changes[0].value.metadata.phone_number_id = '';
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_PHONE_NUMBER_ID');
      }
    });

    it('ignores status updates (no messages)', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value !== undefined) {
        delete payload.entry[0].changes[0].value.messages;
        payload.entry[0].changes[0].value.statuses = [
          { id: 'msg-1', status: 'delivered', timestamp: '1234567890' },
        ];
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_MESSAGES');
        expect(result.value.ignoredReason?.details).toEqual({ hasStatuses: true });
      }
    });

    it('ignores non-text message types', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value.messages?.[0] !== undefined) {
        payload.entry[0].changes[0].value.messages[0].type = 'image';
        delete payload.entry[0].changes[0].value.messages[0].text;
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NON_TEXT_MESSAGE');
        expect(result.value.ignoredReason?.details).toEqual({ messageType: 'image' });
      }
    });

    it('ignores text message with no body', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value.messages?.[0]?.text !== undefined) {
        payload.entry[0].changes[0].value.messages[0].text.body = '';
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_TEXT_BODY');
      }
    });

    it('ignores text message with undefined body', async (): Promise<void> => {
      const payload = createValidPayload();
      if (payload.entry?.[0]?.changes?.[0]?.value.messages?.[0] !== undefined) {
        delete payload.entry[0].changes[0].value.messages[0].text;
      }

      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('NO_TEXT_BODY');
      }
    });
  });

  describe('user mapping', () => {
    it('returns USER_UNMAPPED when no mapping found', async (): Promise<void> => {
      mappingRepo.findUserByPhoneNumber = async () => ok(null);

      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('USER_UNMAPPED');
        expect(result.value.ignoredReason?.code).toBe('USER_UNMAPPED');
      }
    });

    it('returns USER_UNMAPPED when mapping is disconnected', async (): Promise<void> => {
      mappingRepo.getMapping = async () =>
        ok({
          userId: 'user-1',
          phoneNumbers: ['15551234567'],
          inboxNotesDbId: 'notion-db-id',
          connected: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('USER_UNMAPPED');
        expect(result.value.ignoredReason?.code).toBe('USER_DISCONNECTED');
      }
    });

    it('returns USER_UNMAPPED when mapping is null', async (): Promise<void> => {
      mappingRepo.getMapping = async () => ok(null);

      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('USER_UNMAPPED');
        expect(result.value.ignoredReason?.code).toBe('USER_DISCONNECTED');
      }
    });

    it('propagates error from findUserByPhoneNumber', async (): Promise<void> => {
      const error: InboxError = {
        code: 'PERSISTENCE_ERROR',
        message: 'Database error',
      };
      mappingRepo.findUserByPhoneNumber = async () => err(error);

      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });

    it('propagates error from getMapping', async (): Promise<void> => {
      const error: InboxError = {
        code: 'PERSISTENCE_ERROR',
        message: 'Database error',
      };
      mappingRepo.getMapping = async () => err(error);

      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });

  describe('Notion persistence', () => {
    it('returns FAILED when Notion write fails', async (): Promise<void> => {
      const error: InboxError = {
        code: 'PERSISTENCE_ERROR',
        message: 'Notion API error',
      };
      notesRepo.createNote = async () => err(error);

      const payload = createValidPayload();
      const result = await useCase.execute('event-1', payload);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('FAILED');
        expect(result.value.failureDetails).toContain('Notion API error');
      }
    });

    it('updates webhook event status to PROCESSED with note ID', async (): Promise<void> => {
      let capturedStatus: string | undefined;
      let capturedData: object | undefined;

      webhookRepo.updateEventStatus = async (_id, status, data) => {
        capturedStatus = status;
        capturedData = data;
        return ok({
          id: 'event-1',
          payload: {},
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId: '123456789012345',
          status,
          ...(data.ignoredReason && { ignoredReason: data.ignoredReason }),
          ...(data.failureDetails && { failureDetails: data.failureDetails }),
          ...(data.inboxNoteId && { inboxNoteId: data.inboxNoteId }),
        });
      };

      const payload = createValidPayload();
      await useCase.execute('event-1', payload);

      expect(capturedStatus).toBe('PROCESSED');
      expect(capturedData).toEqual({ inboxNoteId: 'note-1' });
    });

    it('updates webhook event status to PROCESSED without note ID if undefined', async (): Promise<void> => {
      notesRepo.createNote = async (note: InboxNote) => ok({ ...note });

      let capturedData: object | undefined;
      webhookRepo.updateEventStatus = async (_id, status, data) => {
        capturedData = data;
        return ok({
          id: 'event-1',
          payload: {},
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId: '123456789012345',
          status,
        });
      };

      const payload = createValidPayload();
      await useCase.execute('event-1', payload);

      expect(capturedData).toEqual({});
    });

    it('updates webhook event status to IGNORED with reason', async (): Promise<void> => {
      let capturedStatus: string | undefined;
      let capturedData: object | undefined;

      webhookRepo.updateEventStatus = async (_id, status, data) => {
        capturedStatus = status;
        capturedData = data;
        return ok({
          id: 'event-1',
          payload: {},
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId: '123456789012345',
          status,
          ...(data.ignoredReason && { ignoredReason: data.ignoredReason }),
        });
      };

      const payload = createValidPayload();
      payload.object = 'instagram_account';

      await useCase.execute('event-1', payload);

      expect(capturedStatus).toBe('IGNORED');
      expect(capturedData).toHaveProperty('ignoredReason');
    });

    it('updates webhook event status to USER_UNMAPPED with reason', async (): Promise<void> => {
      mappingRepo.findUserByPhoneNumber = async () => ok(null);

      let capturedStatus: string | undefined;
      webhookRepo.updateEventStatus = async (_id, status) => {
        capturedStatus = status;
        return ok({
          id: 'event-1',
          payload: {},
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId: '123456789012345',
          status,
        });
      };

      const payload = createValidPayload();
      await useCase.execute('event-1', payload);

      expect(capturedStatus).toBe('USER_UNMAPPED');
    });

    it('updates webhook event status to FAILED with details', async (): Promise<void> => {
      const error: InboxError = {
        code: 'PERSISTENCE_ERROR',
        message: 'Notion API error',
      };
      notesRepo.createNote = async () => err(error);

      let capturedStatus: string | undefined;
      let capturedData: object | undefined;

      webhookRepo.updateEventStatus = async (_id, status, data) => {
        capturedStatus = status;
        capturedData = data;
        return ok({
          id: 'event-1',
          payload: {},
          signatureValid: true,
          receivedAt: new Date().toISOString(),
          phoneNumberId: '123456789012345',
          status,
          ...(data.failureDetails && { failureDetails: data.failureDetails }),
        });
      };

      const payload = createValidPayload();
      await useCase.execute('event-1', payload);

      expect(capturedStatus).toBe('FAILED');
      expect(capturedData).toHaveProperty('failureDetails');
    });
  });
});
