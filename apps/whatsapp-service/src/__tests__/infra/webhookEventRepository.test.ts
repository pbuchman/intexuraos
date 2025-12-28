/**
 * Tests for WhatsApp webhook event Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/common';
import type { Firestore } from '@google-cloud/firestore';
import {
  saveWebhookEvent,
  updateWebhookEventStatus,
  getWebhookEvent,
} from '../../infra/firestore/index.js';

describe('webhookEventRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveWebhookEvent', () => {
    it('saves event and returns with generated id', async () => {
      const result = await saveWebhookEvent({
        payload: { object: 'whatsapp_business_account' },
        signatureValid: true,
        receivedAt: new Date().toISOString(),
        phoneNumberId: '123456',
        status: 'PENDING',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.status).toBe('PENDING');
        expect(result.value.signatureValid).toBe(true);
        expect(result.value.phoneNumberId).toBe('123456');
      }
    });

    it('stores payload correctly', async () => {
      const payload = { test: 'data', nested: { value: 123 } };

      const result = await saveWebhookEvent({
        payload,
        signatureValid: true,
        receivedAt: new Date().toISOString(),
        phoneNumberId: null,
        status: 'PENDING',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const retrieved = await getWebhookEvent(result.value.id);
        expect(retrieved.ok && retrieved.value?.payload).toEqual(payload);
      }
    });
  });

  describe('updateWebhookEventStatus', () => {
    it('updates status to PROCESSED', async () => {
      const saved = await saveWebhookEvent({
        payload: {},
        signatureValid: true,
        receivedAt: new Date().toISOString(),
        phoneNumberId: null,
        status: 'PENDING',
      });

      if (!saved.ok) throw new Error('Setup failed');

      const result = await updateWebhookEventStatus(saved.value.id, 'PROCESSED', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('PROCESSED');
        expect(result.value.processedAt).toBeDefined();
      }
    });

    it('updates status to IGNORED with reason', async () => {
      const saved = await saveWebhookEvent({
        payload: {},
        signatureValid: false,
        receivedAt: new Date().toISOString(),
        phoneNumberId: null,
        status: 'PENDING',
      });

      if (!saved.ok) throw new Error('Setup failed');

      const result = await updateWebhookEventStatus(saved.value.id, 'IGNORED', {
        ignoredReason: { code: 'INVALID_SIG', message: 'Signature mismatch' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('IGNORED');
        expect(result.value.ignoredReason?.code).toBe('INVALID_SIG');
      }
    });

    it('updates status to FAILED with details', async () => {
      const saved = await saveWebhookEvent({
        payload: {},
        signatureValid: true,
        receivedAt: new Date().toISOString(),
        phoneNumberId: null,
        status: 'PENDING',
      });

      if (!saved.ok) throw new Error('Setup failed');

      const result = await updateWebhookEventStatus(saved.value.id, 'FAILED', {
        failureDetails: 'Processing timeout',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('FAILED');
        expect(result.value.failureDetails).toBe('Processing timeout');
      }
    });

    it('updates status to PROCESSED with inboxNoteId', async () => {
      const saved = await saveWebhookEvent({
        payload: {},
        signatureValid: true,
        receivedAt: new Date().toISOString(),
        phoneNumberId: null,
        status: 'PENDING',
      });

      if (!saved.ok) throw new Error('Setup failed');

      const result = await updateWebhookEventStatus(saved.value.id, 'PROCESSED', {
        inboxNoteId: 'note-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('PROCESSED');
        expect(result.value.inboxNoteId).toBe('note-123');
      }
    });

    it('returns error for non-existent event', async () => {
      const result = await updateWebhookEventStatus('nonexistent-id', 'PROCESSED', {});

      // Implementation catches Firestore error and returns PERSISTENCE_ERROR
      expect(result.ok).toBe(false);
    });
  });

  describe('getWebhookEvent', () => {
    it('returns null for non-existent event', async () => {
      const result = await getWebhookEvent('unknown-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns event for existing id', async () => {
      const saved = await saveWebhookEvent({
        payload: { data: 'test' },
        signatureValid: true,
        receivedAt: '2024-01-01T00:00:00Z',
        phoneNumberId: '999',
        status: 'PENDING',
      });

      if (!saved.ok) throw new Error('Setup failed');

      const result = await getWebhookEvent(saved.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.id).toBe(saved.value.id);
        expect(result.value.phoneNumberId).toBe('999');
      }
    });
  });

  describe('error handling', () => {
    it('returns error when Firestore fails on save', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const result = await saveWebhookEvent({
        payload: {},
        signatureValid: true,
        receivedAt: new Date().toISOString(),
        phoneNumberId: null,
        status: 'PENDING',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });

    it('returns error when Firestore fails on get', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await getWebhookEvent('some-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });

    it('returns error when Firestore fails on update', async () => {
      const saved = await saveWebhookEvent({
        payload: {},
        signatureValid: true,
        receivedAt: new Date().toISOString(),
        phoneNumberId: null,
        status: 'PENDING',
      });

      if (!saved.ok) throw new Error('Setup failed');

      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await updateWebhookEventStatus(saved.value.id, 'PROCESSED', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });
});
