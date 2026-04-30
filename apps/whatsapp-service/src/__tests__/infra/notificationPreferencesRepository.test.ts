/**
 * Tests for the notificationPreferencesRepository Firestore adapter.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  getPreferences,
  savePreferences,
} from '../../infra/firestore/notificationPreferencesRepository.js';

describe('notificationPreferencesRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getPreferences', () => {
    it("returns default 'all' when no doc exists", async () => {
      const result = await getPreferences('no-such-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notificationLevel).toBe('all');
      }
    });

    it("returns stored 'important' level", async () => {
      await savePreferences('user-a', 'important');

      const result = await getPreferences('user-a');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notificationLevel).toBe('important');
      }
    });

    it("coerces unknown stored values back to 'all'", async () => {
      // Seed a doc with a bogus notificationLevel field directly into the new collection
      const now = new Date().toISOString();
      await fakeFirestore.collection('whatsapp_notification_preferences').doc('user-bogus').set({
        userId: 'user-bogus',
        notificationLevel: 'LOUD',
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });

      const result = await getPreferences('user-bogus');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notificationLevel).toBe('all');
      }
    });

    it('does NOT read notificationLevel from whatsapp_user_mappings', async () => {
      // Seed stale notificationLevel on the old user-mappings doc
      const now = new Date().toISOString();
      await fakeFirestore.collection('whatsapp_user_mappings').doc('user-1').set({
        userId: 'user-1',
        phoneNumbers: [],
        connected: false,
        createdAt: now,
        updatedAt: now,
        notificationLevel: 'important',
      });

      // No doc in whatsapp_notification_preferences — should return default 'all'
      const result = await getPreferences('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Must return default 'all', NOT 'important' from the stale user-mapping doc
        expect(result.value.notificationLevel).toBe('all');
      }
    });

    it('reads notificationLevel from the dedicated whatsapp_notification_preferences collection', async () => {
      // Set preference directly in new collection
      const now = new Date().toISOString();
      await fakeFirestore.collection('whatsapp_notification_preferences').doc('user-2').set({
        userId: 'user-2',
        notificationLevel: 'important',
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });

      const result = await getPreferences('user-2');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notificationLevel).toBe('important');
      }
    });

    it('returns PERSISTENCE_ERROR when Firestore throws', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await getPreferences('user-a');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });

  describe('savePreferences', () => {
    it('creates a preferences doc when none exists', async () => {
      const result = await savePreferences('user-new', 'important');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notificationLevel).toBe('important');
      }

      // Round-trip via getPreferences
      const read = await getPreferences('user-new');
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.value.notificationLevel).toBe('important');
      }
    });

    it('writes to whatsapp_notification_preferences, not whatsapp_user_mappings', async () => {
      await savePreferences('user-check', 'important');

      // Must be present in the new collection
      const newDoc = await fakeFirestore
        .collection('whatsapp_notification_preferences')
        .doc('user-check')
        .get();
      expect(newDoc.exists).toBe(true);
      const newData = newDoc.data() as { notificationLevel: string };
      expect(newData.notificationLevel).toBe('important');

      // Must NOT be present in the old collection
      const oldDoc = await fakeFirestore
        .collection('whatsapp_user_mappings')
        .doc('user-check')
        .get();
      expect(oldDoc.exists).toBe(false);
    });

    it('stamps schemaVersion and schemaUpdatedAt on the doc', async () => {
      await savePreferences('user-schema', 'all');

      const doc = await fakeFirestore
        .collection('whatsapp_notification_preferences')
        .doc('user-schema')
        .get();
      expect(doc.exists).toBe(true);
      const data = doc.data() as { schemaVersion: number; schemaUpdatedAt: unknown };
      expect(data.schemaVersion).toBe(1);
      expect(data.schemaUpdatedAt).toEqual(expect.any(Object));
    });

    it('preserves createdAt on subsequent updates', async () => {
      await savePreferences('user-ts', 'all');
      const after1 = await fakeFirestore
        .collection('whatsapp_notification_preferences')
        .doc('user-ts')
        .get();
      const createdAt1 = (after1.data() as { createdAt: string }).createdAt;

      // Update the preference
      await savePreferences('user-ts', 'important');
      const after2 = await fakeFirestore
        .collection('whatsapp_notification_preferences')
        .doc('user-ts')
        .get();
      const createdAt2 = (after2.data() as { createdAt: string }).createdAt;

      expect(createdAt2).toBe(createdAt1);
    });

    it('round-trips saved level back through getPreferences', async () => {
      await savePreferences('user-rt', 'important');
      const after1 = await getPreferences('user-rt');
      expect(after1.ok).toBe(true);
      if (after1.ok) expect(after1.value.notificationLevel).toBe('important');

      await savePreferences('user-rt', 'all');
      const after2 = await getPreferences('user-rt');
      expect(after2.ok).toBe(true);
      if (after2.ok) expect(after2.value.notificationLevel).toBe('all');
    });

    it('returns PERSISTENCE_ERROR when Firestore throws', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write error') });

      const result = await savePreferences('user-a', 'important');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });
});
