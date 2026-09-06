import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';
import {
  INTEX_AGENT_PROMPT_PREFERENCES_COLLECTION,
  INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION,
  FirestorePromptPreferencesRepository,
} from '../../../infra/firestore/promptPreferencesRepository.js';

const webActor = { actor: 'web_ui' as const, userId: 'user-1' };

describe('FirestorePromptPreferencesRepository', () => {
  it('returns empty prompt preferences when no document exists', async () => {
    const repo = createRepo();

    await expect(repo.getCurrent('user-1')).resolves.toMatchObject({
      userId: 'user-1',
      currentVersion: 0,
      items: [],
      renderedPromptBlock: '',
      createdAt: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('adds an item and writes an immutable version snapshot', async () => {
    const repo = createRepo({
      ids: ['pref_jakub'],
      times: ['2026-06-28T10:00:00.000Z'],
    });

    const current = await repo.addItem({
      userId: 'user-1',
      text: '  When I ask to invite Jakub, invite jakub@gmail.com.  ',
      expectedVersion: 0,
      updatedBy: webActor,
    });

    expect(current).toMatchObject({
      userId: 'user-1',
      currentVersion: 1,
      renderedPromptBlock:
        'User Preferences v1:\n1. (id: pref_jakub) "When I ask to invite Jakub, invite jakub@gmail.com."',
      updatedBy: webActor,
    });
    expect(current.items).toEqual([
      {
        id: 'pref_jakub',
        text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
        createdAt: '2026-06-28T10:00:00.000Z',
        updatedAt: '2026-06-28T10:00:00.000Z',
      },
    ]);

    await expect(repo.listVersions('user-1')).resolves.toEqual([
      {
        version: 1,
        changeType: 'add',
        changedItemId: 'pref_jakub',
        nextText: 'When I ask to invite Jakub, invite jakub@gmail.com.',
        itemCount: 1,
        createdAt: '2026-06-28T10:00:00.000Z',
        createdBy: webActor,
      },
    ]);
    await expect(repo.getVersion('user-1', 1)).resolves.toMatchObject({
      id: 'user-1_1',
      userId: 'user-1',
      version: 1,
      renderedPromptBlock: current.renderedPromptBlock,
      items: current.items,
    });
  });

  it('uses default timestamps and ids when optional dependencies are omitted', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    const repo = new FirestorePromptPreferencesRepository({ firestore });

    const current = await repo.addItem({
      userId: 'user-1',
      text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      expectedVersion: 0,
      updatedBy: webActor,
    });

    expect(current.currentVersion).toBe(1);
    expect(current.items[0]?.id).toMatch(/^pref_[a-f0-9]{12}$/u);
    expect(current.items[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    await expect(repo.getCurrent('user-1')).resolves.toMatchObject({
      currentVersion: 1,
      items: [{ id: current.items[0]?.id }],
    });
  });

  it('updates and deletes items while retaining historical snapshots', async () => {
    const repo = createRepo({
      ids: ['pref_jakub'],
      times: [
        '2026-06-28T10:00:00.000Z',
        '2026-06-28T10:01:00.000Z',
        '2026-06-28T10:02:00.000Z',
      ],
    });

    await repo.addItem({
      userId: 'user-1',
      text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      expectedVersion: 0,
      updatedBy: webActor,
    });
    const updated = await repo.updateItem({
      userId: 'user-1',
      itemId: 'pref_jakub',
      text: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
      expectedVersion: 1,
      updatedBy: webActor,
    });
    const deleted = await repo.deleteItem({
      userId: 'user-1',
      itemId: 'pref_jakub',
      expectedVersion: 2,
      updatedBy: webActor,
    });

    expect(updated).toMatchObject({
      currentVersion: 2,
      renderedPromptBlock:
        'User Preferences v2:\n1. (id: pref_jakub) "When I ask to invite Jakub, invite jakub.nowak@gmail.com."',
    });
    expect(deleted).toMatchObject({
      currentVersion: 3,
      items: [],
      renderedPromptBlock: '',
    });
    await expect(repo.listVersions('user-1')).resolves.toMatchObject([
      {
        version: 3,
        changeType: 'delete',
        previousText: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
        itemCount: 0,
      },
      {
        version: 2,
        changeType: 'update',
        previousText: 'When I ask to invite Jakub, invite jakub@gmail.com.',
        nextText: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
        itemCount: 1,
      },
      {
        version: 1,
        changeType: 'add',
        nextText: 'When I ask to invite Jakub, invite jakub@gmail.com.',
        itemCount: 1,
      },
    ]);
    await expect(repo.getVersion('user-1', 1)).resolves.toMatchObject({
      version: 1,
      renderedPromptBlock:
        'User Preferences v1:\n1. (id: pref_jakub) "When I ask to invite Jakub, invite jakub@gmail.com."',
    });
  });

  it('rejects stale expected versions with the latest current preferences', async () => {
    const repo = createRepo({
      ids: ['pref_jakub'],
      times: ['2026-06-28T10:00:00.000Z'],
    });
    await repo.addItem({
      userId: 'user-1',
      text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      expectedVersion: 0,
      updatedBy: webActor,
    });

    await expect(
      repo.addItem({
        userId: 'user-1',
        text: 'Another row',
        expectedVersion: 0,
        updatedBy: webActor,
      })
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      current: expect.objectContaining({ currentVersion: 1 }),
    });
  });

  it('rejects unknown items and missing historical versions', async () => {
    const repo = createRepo();

    await expect(
      repo.updateItem({
        userId: 'user-1',
        itemId: 'pref_missing',
        text: 'Missing',
        expectedVersion: 0,
        updatedBy: webActor,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(repo.getVersion('user-1', 42)).resolves.toBeNull();
  });

  it('ignores historical versions whose stored owner does not match the requested user', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION)
      .doc('user-1_1')
      .set({
        id: 'user-1_1',
        userId: 'user-2',
        version: 1,
        items: [],
        renderedPromptBlock: '',
        changeType: 'add',
        itemCount: 0,
        createdAt: '2026-06-28T10:00:00.000Z',
        createdBy: webActor,
      });
    const repo = createRepo({ firestore });

    await expect(repo.getVersion('user-1', 1)).resolves.toBeNull();
  });

  it('maps malformed current documents to safe defaults and filters malformed items', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCES_COLLECTION)
      .doc('array-user')
      .set([] as unknown as Record<string, unknown>);
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCES_COLLECTION)
      .doc('string-user')
      .set('bad data' as unknown as Record<string, unknown>);
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCES_COLLECTION)
      .doc('malformed-user')
      .set({
        currentVersion: 'not-a-number',
        items: [
          {
            id: 'pref_valid',
            text: 'Valid row.',
            createdAt: '2026-06-28T10:00:00.000Z',
            updatedAt: '2026-06-28T10:00:00.000Z',
          },
          { id: 'pref_invalid', text: 'Missing timestamps.' },
        ],
        renderedPromptBlock: 123,
        createdAt: '2026-06-28T10:00:00.000Z',
        updatedAt: 456,
        updatedBy: {
          actor: 'agent_tool',
          userId: 'user-1',
          sessionId: 'session-1',
          messageId: 'message-1',
        },
      });
    const repo = createRepo({ firestore });

    await expect(repo.getCurrent('array-user')).resolves.toMatchObject({
      currentVersion: 0,
      items: [],
      renderedPromptBlock: '',
      createdAt: null,
      updatedAt: null,
      updatedBy: null,
    });
    await expect(repo.getCurrent('string-user')).resolves.toMatchObject({
      currentVersion: 0,
      items: [],
    });
    await expect(repo.getCurrent('malformed-user')).resolves.toMatchObject({
      currentVersion: 0,
      items: [{ id: 'pref_valid' }],
      renderedPromptBlock: '',
      createdAt: '2026-06-28T10:00:00.000Z',
      updatedAt: null,
      updatedBy: {
        actor: 'agent_tool',
        userId: 'user-1',
        sessionId: 'session-1',
        messageId: 'message-1',
      },
    });
  });

  it('maps sparse historical version documents and rejects versions without creators', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION)
      .doc('user-1_1')
      .set({
        id: 'user-1_1',
        userId: 'user-1',
        version: 'not-a-number',
        items: [
          {
            id: 'pref_valid',
            text: 'Valid row.',
            createdAt: '2026-06-28T10:00:00.000Z',
            updatedAt: '2026-06-28T10:00:00.000Z',
          },
          { id: 'pref_invalid' },
        ],
        renderedPromptBlock: 100,
        changeType: 'unknown',
        createdAt: '2026-06-28T10:00:00.000Z',
        createdBy: { actor: 'agent_tool', userId: 'user-1', sessionId: 'session-1' },
      });
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION)
      .doc('user-1_2')
      .set({
        id: 'user-1_2',
        userId: 'user-1',
        version: 2,
        items: [],
        renderedPromptBlock: '',
        changeType: 'add',
        itemCount: 0,
        createdAt: '2026-06-28T10:01:00.000Z',
      });
    const repo = createRepo({ firestore });

    await expect(repo.getVersion('user-1', 1)).resolves.toMatchObject({
      version: 0,
      items: [{ id: 'pref_valid' }],
      renderedPromptBlock: '',
      changeType: 'add',
      itemCount: 2,
      createdBy: { actor: 'agent_tool', userId: 'user-1', sessionId: 'session-1' },
    });
  });

  it('summarizes sparse historical versions without optional change text', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION)
      .doc('user-1_1')
      .set({
        id: 'user-1_1',
        userId: 'user-1',
        version: 1,
        items: [],
        renderedPromptBlock: '',
        changeType: 'add',
        itemCount: 0,
        createdAt: '2026-06-28T10:00:00.000Z',
        createdBy: webActor,
      });
    const repo = createRepo({ firestore });

    await expect(repo.listVersions('user-1')).resolves.toEqual([
      {
        version: 1,
        changeType: 'add',
        itemCount: 0,
        createdAt: '2026-06-28T10:00:00.000Z',
        createdBy: webActor,
      },
    ]);
  });

  it('rejects historical versions without creators', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION)
      .doc('user-1_2')
      .set({
        id: 'user-1_2',
        userId: 'user-1',
        version: 2,
        items: [],
        renderedPromptBlock: '',
        changeType: 'add',
        itemCount: 0,
        createdAt: '2026-06-28T10:01:00.000Z',
      });
    const repo = createRepo({ firestore });

    await expect(repo.listVersions('user-1')).rejects.toThrow(
      'Prompt preference version user-1_2 is missing createdBy'
    );
  });

  it('does not overwrite an existing immutable version document', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    await firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION)
      .doc('user-1_1')
      .set({
        id: 'user-1_1',
        userId: 'user-1',
        version: 1,
        items: [],
        renderedPromptBlock: '',
        changeType: 'add',
        itemCount: 0,
        createdAt: '2026-06-28T09:00:00.000Z',
        createdBy: webActor,
      });
    const repo = createRepo({
      firestore,
      ids: ['pref_jakub'],
      times: ['2026-06-28T10:00:00.000Z'],
    });

    await expect(
      repo.addItem({
        userId: 'user-1',
        text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
        expectedVersion: 0,
        updatedBy: webActor,
      })
    ).rejects.toThrow('Preference version user-1_1 already exists');
    await expect(repo.getCurrent('user-1')).resolves.toMatchObject({
      currentVersion: 0,
      items: [],
    });
  });

  it('stores prompt preferences separately from legacy External Save preferences', async () => {
    const firestore = createFakeFirestore() as unknown as Firestore;
    await firestore
      .collection('intex_agent_user_preferences')
      .doc('user-1')
      .set({
        instructions: 'legacy instructions that should not be injected',
        externalSave: {
          enabled: true,
          endpointUrl: 'https://external-save.example.com/intex',
          cfAccessClientId: 'cf-client-id',
          cfAccessClientSecret: 'cf-client-secret',
          source: 'ios-shortcuts',
        },
        updatedAt: '2026-06-27T10:00:00.000Z',
      });
    const repo = createRepo({
      firestore,
      ids: ['pref_jakub'],
      times: ['2026-06-28T10:00:00.000Z'],
    });

    await repo.addItem({
      userId: 'user-1',
      text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      expectedVersion: 0,
      updatedBy: webActor,
    });

    await expect(
      firestore.collection('intex_agent_user_preferences').doc('user-1').get().then((doc) => doc.data())
    ).resolves.toMatchObject({
      instructions: 'legacy instructions that should not be injected',
      externalSave: {
        enabled: true,
        endpointUrl: 'https://external-save.example.com/intex',
        cfAccessClientId: 'cf-client-id',
        cfAccessClientSecret: 'cf-client-secret',
        source: 'ios-shortcuts',
      },
    });
    await expect(
      firestore.collection(INTEX_AGENT_PROMPT_PREFERENCES_COLLECTION).doc('user-1').get()
    ).resolves.toMatchObject({ exists: true });
  });
});

function createRepo(options?: {
  firestore?: Firestore;
  ids?: string[];
  times?: string[];
}): FirestorePromptPreferencesRepository {
  const firestore = options?.firestore ?? (createFakeFirestore() as unknown as Firestore);
  const ids = options?.ids ?? ['pref_generated'];
  const times = options?.times ?? ['2026-06-28T10:00:00.000Z'];
  let idIndex = 0;
  let timeIndex = 0;
  return new FirestorePromptPreferencesRepository({
    firestore,
    createItemId: () => ids[idIndex++] ?? 'pref_fallback',
    now: () => times[timeIndex++] ?? '2026-06-28T10:59:00.000Z',
  });
}
