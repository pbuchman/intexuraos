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

  it('deletes preferences and returns null on subsequent get', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePreferencesRepository({ firestore });

    await repo.savePreferences('user-1', { instructions: 'hello' });
    await repo.deletePreferences('user-1');

    await expect(repo.getPreferences('user-1')).resolves.toBeNull();
  });
});