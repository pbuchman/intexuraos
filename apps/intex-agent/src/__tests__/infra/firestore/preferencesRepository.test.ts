import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';
import { FirestorePreferencesRepository } from '../../../infra/firestore/preferencesRepository.js';

describe('FirestorePreferencesRepository', () => {
  it('returns null when no preferences are stored', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    await expect(repo.getPreferences('user-1')).resolves.toBeNull();
  });

  it('persists and retrieves preferences per user', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    const saved = await repo.savePreferences('user-1', {
      instructions: 'Always invite Monika to meetings.',
    });

    expect(saved.userId).toBe('user-1');
    expect(saved.instructions).toBe('Always invite Monika to meetings.');
    expect(typeof saved.updatedAt).toBe('string');

    const fetched = await repo.getPreferences('user-1');
    expect(fetched).toEqual(saved);
  });

  it('persists and retrieves external save configuration', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    const saved = await repo.savePreferences('user-1', {
      instructions: '',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
    });

    expect(saved.externalSave).toEqual({
      enabled: true,
      endpointUrl: 'https://external-save.example.com/intex',
      cfAccessClientId: 'cf-client-id',
      cfAccessClientSecret: 'cf-client-secret',
      source: 'ios-shortcuts',
    });
    await expect(repo.getPreferences('user-1')).resolves.toEqual(saved);
  });

  it('isolates preferences across users', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    await repo.savePreferences('user-1', { instructions: 'user 1 prefs' });
    await repo.savePreferences('user-2', { instructions: 'user 2 prefs' });

    await expect(repo.getPreferences('user-1')).resolves.toMatchObject({
      instructions: 'user 1 prefs',
    });
    await expect(repo.getPreferences('user-2')).resolves.toMatchObject({
      instructions: 'user 2 prefs',
    });
  });

  it('overwrites previous preferences on save', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    await repo.savePreferences('user-1', { instructions: 'first' });
    await repo.savePreferences('user-1', { instructions: 'second' });

    await expect(repo.getPreferences('user-1')).resolves.toMatchObject({
      instructions: 'second',
    });
  });

  it('removes external save configuration when a later save omits it', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    await repo.savePreferences('user-1', {
      instructions: 'first',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
    });
    await repo.savePreferences('user-1', { instructions: 'second' });

    const fetched = await repo.getPreferences('user-1');
    expect(fetched?.externalSave).toBeUndefined();
  });

  it('ignores malformed stored external save configuration', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    await firestore.collection('intex_agent_user_preferences').doc('user-1').set({
      instructions: 'existing',
      externalSave: null,
      updatedAt: '2026-06-27T10:00:00.000Z',
    });

    await expect(repo.getPreferences('user-1')).resolves.toEqual({
      userId: 'user-1',
      instructions: 'existing',
      updatedAt: '2026-06-27T10:00:00.000Z',
    });
  });

  it('deletes preferences and returns null on subsequent get', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    await repo.savePreferences('user-1', { instructions: 'hello' });
    await repo.deletePreferences('user-1');

    await expect(repo.getPreferences('user-1')).resolves.toBeNull();
  });
});
