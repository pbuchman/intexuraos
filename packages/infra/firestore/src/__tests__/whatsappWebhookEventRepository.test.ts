/**
 * Tests for WhatsApp webhook event repository implementations.
 *
 * FakeWhatsAppWebhookEventRepository - for domain package testing.
 * FirestoreWhatsAppWebhookEventRepository - uses real Firestore against emulator.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeWhatsAppWebhookEventRepository } from '../testing/fakeWhatsAppWebhookEventRepository.js';
import { FirestoreWhatsAppWebhookEventRepository } from '../whatsappWebhookEventRepository.js';

describe('FakeWhatsAppWebhookEventRepository', () => {
  let repository: FakeWhatsAppWebhookEventRepository;

  beforeEach(() => {
    repository = new FakeWhatsAppWebhookEventRepository();
  });

  it('saves an event and generates an ID', async (): Promise<void> => {
    const event = {
      payload: { test: 'data' },
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: '123456789',
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeDefined();
      expect(result.value.id.length).toBeGreaterThan(0);
      expect(result.value.payload).toEqual(event.payload);
      expect(result.value.signatureValid).toBe(true);
      expect(result.value.phoneNumberId).toBe('123456789');
    }
  });

  it('retrieves all saved events', async (): Promise<void> => {
    const event1 = {
      payload: { msg: 'first' },
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: '111',
      status: 'PENDING' as const,
    };
    const event2 = {
      payload: { msg: 'second' },
      signatureValid: false,
      receivedAt: new Date().toISOString(),
      phoneNumberId: '222',
      status: 'PENDING' as const,
    };

    await repository.saveEvent(event1);
    await repository.saveEvent(event2);

    const events = repository.getAll();
    expect(events.length).toBe(2);
  });

  it('retrieves event by ID', async (): Promise<void> => {
    const event = {
      payload: { test: 'byId' },
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: '333',
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    if (result.ok) {
      const retrieved = repository.getById(result.value.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.payload).toEqual({ test: 'byId' });
    }
  });

  it('returns undefined for non-existent ID', (): void => {
    const retrieved = repository.getById('non-existent-id');
    expect(retrieved).toBeUndefined();
  });

  it('clears all events', async (): Promise<void> => {
    await repository.saveEvent({
      payload: {},
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: null,
      status: 'PENDING' as const,
    });

    repository.clear();

    const events = repository.getAll();
    expect(events.length).toBe(0);
  });

  it('handles null phoneNumberId', async (): Promise<void> => {
    const event = {
      payload: {},
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: null,
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phoneNumberId).toBeNull();
    }
  });
});

describe('FirestoreWhatsAppWebhookEventRepository', () => {
  function createRepo(): FirestoreWhatsAppWebhookEventRepository {
    return new FirestoreWhatsAppWebhookEventRepository();
  }

  describe('saveEvent', () => {
    it('saves event to Firestore successfully', async (): Promise<void> => {
      const repo = createRepo();
      const event = {
        payload: { test: 'data' },
        signatureValid: true,
        receivedAt: '2025-01-01T00:00:00.000Z',
        phoneNumberId: '123456789',
        status: 'PENDING' as const,
      };

      const result = await repo.saveEvent(event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.payload).toEqual(event.payload);
        expect(result.value.signatureValid).toBe(true);
        expect(result.value.phoneNumberId).toBe('123456789');
        expect(result.value.status).toBe('PENDING');
      }
    });

    it('handles null phoneNumberId', async (): Promise<void> => {
      const repo = createRepo();
      const event = {
        payload: {},
        signatureValid: true,
        receivedAt: '2025-01-01T00:00:00.000Z',
        phoneNumberId: null,
        status: 'PENDING' as const,
      };

      const result = await repo.saveEvent(event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phoneNumberId).toBeNull();
      }
    });
  });

  describe('getEvent', () => {
    it('retrieves saved event by ID', async (): Promise<void> => {
      const repo = createRepo();
      const event = {
        payload: { test: 'retrieve' },
        signatureValid: true,
        receivedAt: '2025-01-01T00:00:00.000Z',
        phoneNumberId: '999',
        status: 'PENDING' as const,
      };

      const saveResult = await repo.saveEvent(event);
      expect(saveResult.ok).toBe(true);
      if (!saveResult.ok) return;

      const result = await repo.getEvent(saveResult.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.payload).toEqual(event.payload);
      }
    });

    it('returns null for non-existent event', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.getEvent('non-existent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('updateEventStatus', () => {
    it('updates event status', async (): Promise<void> => {
      const repo = createRepo();
      const event = {
        payload: {},
        signatureValid: true,
        receivedAt: '2025-01-01T00:00:00.000Z',
        phoneNumberId: '123',
        status: 'PENDING' as const,
      };

      const saveResult = await repo.saveEvent(event);
      expect(saveResult.ok).toBe(true);
      if (!saveResult.ok) return;

      const result = await repo.updateEventStatus(saveResult.value.id, 'PROCESSED', {
        inboxNoteId: 'note-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('PROCESSED');
        expect(result.value.inboxNoteId).toBe('note-123');
      }
    });

    it('updates event status with error', async (): Promise<void> => {
      const repo = createRepo();
      const event = {
        payload: {},
        signatureValid: true,
        receivedAt: '2025-01-01T00:00:00.000Z',
        phoneNumberId: '123',
        status: 'PENDING' as const,
      };

      const saveResult = await repo.saveEvent(event);
      expect(saveResult.ok).toBe(true);
      if (!saveResult.ok) return;

      const result = await repo.updateEventStatus(saveResult.value.id, 'FAILED', {
        failureDetails: 'Processing failed',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('FAILED');
        expect(result.value.failureDetails).toBe('Processing failed');
      }
    });

    it('returns error for non-existent event', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.updateEventStatus('non-existent-id', 'PROCESSED', {});

      // Firestore update() on non-existent doc throws, which causes PERSISTENCE_ERROR
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });
});
