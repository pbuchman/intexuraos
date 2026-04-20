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
import { saveUserMapping } from '../../infra/firestore/userMappingRepository.js';

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
      // Seed a doc with a bogus notificationLevel field
      const now = new Date().toISOString();
      await fakeFirestore.collection('whatsapp_user_mappings').doc('user-bogus').set({
        userId: 'user-bogus',
        phoneNumbers: [],
        connected: false,
        createdAt: now,
        updatedAt: now,
        notificationLevel: 'LOUD',
      });

      const result = await getPreferences('user-bogus');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notificationLevel).toBe('all');
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
    it('creates a mapping doc when none exists', async () => {
      const result = await savePreferences('user-new', 'important');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notificationLevel).toBe('important');
      }

      // Round-trip
      const read = await getPreferences('user-new');
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.value.notificationLevel).toBe('important');
      }
    });

    it('does not overwrite phoneNumbers on existing doc', async () => {
      // Seed an existing connected mapping
      await saveUserMapping('user-existing', ['15551234567']);

      const save = await savePreferences('user-existing', 'important');
      expect(save.ok).toBe(true);

      // Read back the underlying doc to confirm phone numbers are still there.
      const doc = await fakeFirestore
        .collection('whatsapp_user_mappings')
        .doc('user-existing')
        .get();
      expect(doc.exists).toBe(true);
      const data = doc.data() as {
        phoneNumbers: string[];
        notificationLevel: string;
        connected: boolean;
      };
      expect(data.phoneNumbers).toEqual(['15551234567']);
      expect(data.notificationLevel).toBe('important');
      expect(data.connected).toBe(true);
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
