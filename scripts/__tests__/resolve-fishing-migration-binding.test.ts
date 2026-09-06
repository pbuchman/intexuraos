import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FISHING_GROUP_KEY,
  hashArchiveDocuments,
} from '../message-digests/fishing-group-migration.mjs';
import { resolveFishingMigrationBinding } from '../message-digests/resolve-fishing-migration-binding.mjs';

interface StoredDocument {
  id: string;
  data: Record<string, unknown>;
}

interface SyntheticSnapshot {
  id: string;
  data: () => Record<string, unknown>;
}

interface SyntheticQuery {
  where: (field: string, operator: string, value: unknown) => SyntheticQuery;
  limit: (value: number) => SyntheticQuery;
  get: () => Promise<{ docs: SyntheticSnapshot[] }>;
  doc: (id: string) => {
    get: () => Promise<{
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    }>;
  };
}

interface SyntheticFirestore {
  collection: (name: string) => SyntheticQuery;
}

interface BindingFixture {
  previousReleaseDir: string;
  firestore: SyntheticFirestore;
  firestoreCollections: string[];
  fetchImplementation: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

describe('Fishing migration binding resolver', () => {
  it('selects one NFKC/trim-normalized exact group and preserves its presentation name', async () => {
    const fixture = createFixture({
      chats: [
        chat('chat-exact', { displayName: '  Grupa We\u0328dkarska  ' }),
        chat('chat-lookalike', { displayName: 'Grupa Wędkarska VIP' }),
      ],
    });
    try {
      await expect(resolveBinding(fixture)).resolves.toMatchObject({
        INTEXURAOS_MESSAGE_DIGEST_MIGRATION_CHAT_ID: 'chat-exact',
        INTEXURAOS_MESSAGE_DIGEST_MIGRATION_GROUP_NAME: 'Grupa We\u0328dkarska',
        INTEXURAOS_MESSAGE_DIGEST_MIGRATION_SOURCE_GENERATION_ID: 'generation-active',
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('accepts the unique group across case, accent, and separator drift', async () => {
    const fixture = createFixture({
      chats: [
        chat('chat-exact', { displayName: 'GRUPA-WEDKARSKA!' }),
        chat('chat-lookalike', { displayName: 'Grupa Wędkarska VIP' }),
      ],
    });
    try {
      await expect(resolveBinding(fixture)).resolves.toMatchObject({
        INTEXURAOS_MESSAGE_DIGEST_MIGRATION_CHAT_ID: 'chat-exact',
        INTEXURAOS_MESSAGE_DIGEST_MIGRATION_GROUP_NAME: 'GRUPA-WEDKARSKA!',
      });
    } finally {
      fixture.cleanup();
    }
  });

  it.each([
    ['suffix lookalike', 'Grupa Wędkarska VIP'],
    ['prefix lookalike', 'VIP Grupa Wędkarska'],
  ])('rejects a %s without an exact group', async (_label, displayName) => {
    const fixture = createFixture({ chats: [chat('chat-lookalike', { displayName })] });
    try {
      await expect(resolveBinding(fixture)).rejects.toThrow('MIGRATION_BINDING_CHAT_NOT_UNIQUE');
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects zero or multiple exact matches', async () => {
    const missing = createFixture({ chats: [] });
    const duplicate = createFixture({
      chats: [chat('chat-a'), chat('chat-b')],
    });
    try {
      await expect(resolveBinding(missing)).rejects.toThrow('MIGRATION_BINDING_CHAT_NOT_UNIQUE');
      await expect(resolveBinding(duplicate)).rejects.toThrow('MIGRATION_BINDING_CHAT_NOT_UNIQUE');
    } finally {
      missing.cleanup();
      duplicate.cleanup();
    }
  });

  it('rejects a group outside the active source account', async () => {
    const foreign = createFixture({
      chats: [chat('chat-foreign', { sourceAccountId: 'source-foreign' })],
    });
    try {
      await expect(resolveBinding(foreign)).rejects.toThrow('MIGRATION_BINDING_CHAT_NOT_UNIQUE');
    } finally {
      foreign.cleanup();
    }
  });

  it.each([
    { status: 'disconnected' },
    { userId: 'user-foreign' },
    { sourceAccountId: '' },
    { generationId: '' },
  ])('rejects an invalid active account snapshot %#', async (accountOverride) => {
    const fixture = createFixture({ account: accountOverride });
    try {
      await expect(resolveBinding(fixture)).rejects.toThrow('MIGRATION_BINDING_ACCOUNT_INVALID');
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects an unbounded owned legacy snapshot before calling WhatsApp', async () => {
    const unboundedOwnership = createFixture({
      digests: Array.from({ length: 1_001 }, (_, index) => legacyDigest(`digest-${index}`)),
    });
    try {
      await expect(resolveBinding(unboundedOwnership)).rejects.toThrow(
        'MIGRATION_BINDING_QUERY_TOO_LARGE'
      );
      expect(unboundedOwnership.fetchImplementation).not.toHaveBeenCalled();
    } finally {
      unboundedOwnership.cleanup();
    }
  });

  it('uses the cutover-role WhatsApp API without reading WhatsApp-owned Firestore collections', async () => {
    const fixture = createFixture();
    try {
      await resolveBinding(fixture);

      expect(fixture.fetchImplementation).toHaveBeenCalledOnce();
      const [url, init] = fixture.fetchImplementation.mock.calls[0] ?? [];
      expect(url).toBe(
        'https://whatsapp.internal.example/internal/whatsapp/private/digest-source/migration-binding/resolve'
      );
      const headers = new Headers(init?.headers);
      expect(headers.get('x-internal-auth')).toBe('private-internal-token');
      expect(headers.get('x-internal-caller-role')).toBe('message_digest_cutover_verifier');
      expect(JSON.parse(String(init?.body))).toEqual({
        userId: 'user-owner',
        expectedDisplayName: 'Grupa Wędkarska',
      });
      expect(fixture.firestoreCollections).not.toContain('whatsapp_private_accounts');
      expect(fixture.firestoreCollections).not.toContain('whatsapp_private_chats');
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects empty audited legacy ownership', async () => {
    const fixture = createFixture({
      digests: [legacyDigest('post-audit', { date: '2026-07-27' })],
    });
    try {
      await expect(resolveBinding(fixture)).rejects.toThrow('MIGRATION_BINDING_LEGACY_EMPTY');
    } finally {
      fixture.cleanup();
    }
  });

  it('freezes the state hash at the last meaningful checkpoint and ignores later audit states', async () => {
    const frozenState = legacyState('state-frozen');
    const fixture = createFixture({
      states: [
        frozenState,
        legacyState('state-later', {
          date: '2026-07-30',
          state: {
            userId: 'user-owner',
            groupKey: FISHING_GROUP_KEY,
            updatedAt: '2026-07-30T03:06:00.000Z',
          },
        }),
      ],
    });
    try {
      await expect(resolveBinding(fixture)).resolves.toMatchObject({
        INTEXURAOS_MESSAGE_DIGEST_MIGRATION_LEGACY_STATE_HASH: hashArchiveDocuments([frozenState]),
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects an archive that has later audit states but no frozen checkpoint state', async () => {
    const fixture = createFixture({
      states: [
        legacyState('state-later', {
          date: '2026-07-30',
          state: {
            userId: 'user-owner',
            groupKey: FISHING_GROUP_KEY,
            updatedAt: '2026-07-30T03:06:00.000Z',
          },
        }),
      ],
    });
    try {
      await expect(resolveBinding(fixture)).rejects.toThrow('MIGRATION_BINDING_LEGACY_EMPTY');
    } finally {
      fixture.cleanup();
    }
  });
});

function resolveBinding(
  fixture: ReturnType<typeof createFixture>
): Promise<Record<string, string>> {
  return resolveFishingMigrationBinding({
    projectId: 'synthetic-project',
    previousReleaseDir: fixture.previousReleaseDir,
    firestore: fixture.firestore,
    whatsappServiceUrl: 'https://whatsapp.internal.example',
    internalAuthToken: 'private-internal-token',
    fetchImplementation: fixture.fetchImplementation,
  });
}

function createFixture(
  overrides: {
    digests?: StoredDocument[];
    states?: StoredDocument[];
    chats?: StoredDocument[];
    account?: Record<string, unknown>;
  } = {}
): BindingFixture {
  const previousReleaseDir = mkdtempSync(resolve(tmpdir(), 'fishing-binding-release-'));
  const legacyDomainDir = resolve(
    previousReleaseDir,
    'apps/mobile-notifications-service/src/domain'
  );
  mkdirSync(legacyDomainDir, { recursive: true });
  writeFileSync(
    resolve(legacyDomainDir, 'digestSubscriptions.ts'),
    `export const subscriptions = [{ groupKey: '${FISHING_GROUP_KEY}', groupTitlePrefix: 'Grupa Wędkarska' }];\n`,
    'utf8'
  );
  const collections = new Map<string, StoredDocument[]>([
    ['notification_daily_digests', overrides.digests ?? [legacyDigest('digest-owned')]],
    ['notification_group_states', overrides.states ?? [legacyState('state-owned')]],
  ]);
  const firestoreCollections: string[] = [];
  const account = {
    userId: 'user-owner',
    status: 'active',
    sourceAccountId: 'source-active',
    generationId: 'generation-active',
    ...overrides.account,
  };
  const chats = overrides.chats ?? [chat('chat-exact')];
  const fetchImplementation = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      userId: string;
      expectedDisplayName: string;
    };
    if (
      account.userId !== body.userId ||
      account.status !== 'active' ||
      typeof account.sourceAccountId !== 'string' ||
      account.sourceAccountId === '' ||
      typeof account.generationId !== 'string' ||
      account.generationId === ''
    ) {
      return jsonResponse({ success: false, error: { code: 'NOT_FOUND' } }, 404);
    }
    const matches = chats.filter(
      (candidate) =>
        candidate.data.userId === body.userId &&
        candidate.data.sourceAccountId === account.sourceAccountId &&
        candidate.data.chatType === 'group' &&
        typeof candidate.data.displayName === 'string' &&
        normalizeComparableGroupName(candidate.data.displayName) ===
          normalizeComparableGroupName(body.expectedDisplayName)
    );
    if (matches.length !== 1) {
      return jsonResponse({ success: false, error: { code: 'SOURCE_CHANGED' } }, 409);
    }
    const candidate = matches[0];
    return jsonResponse({
      success: true,
      data: {
        sourceAccountId: account.sourceAccountId,
        generationId: account.generationId,
        chatId: candidate?.id,
        displayName: String(candidate?.data.displayName).trim(),
      },
    });
  });
  return {
    previousReleaseDir,
    firestore: fakeFirestore(collections, firestoreCollections),
    firestoreCollections,
    fetchImplementation,
    cleanup: (): void => rmSync(previousReleaseDir, { recursive: true, force: true }),
  };
}

function normalizeComparableGroupName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pl-PL')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function fakeFirestore(
  collections: Map<string, StoredDocument[]>,
  observed: string[]
): SyntheticFirestore {
  return {
    collection(name: string): SyntheticQuery {
      observed.push(name);
      if (name.startsWith('whatsapp_')) throw new Error('Cross-owner Firestore access');
      const filters: { field: string; value: unknown }[] = [];
      let limit = Number.POSITIVE_INFINITY;
      const query = {
        where(field: string, operator: string, value: unknown): SyntheticQuery {
          if (operator !== '==') throw new Error('Unsupported synthetic query');
          filters.push({ field, value });
          return query;
        },
        limit(value: number): SyntheticQuery {
          limit = value;
          return query;
        },
        async get(): Promise<{ docs: SyntheticSnapshot[] }> {
          const documents = (collections.get(name) ?? [])
            .filter((document) =>
              filters.every((filter) => document.data[filter.field] === filter.value)
            )
            .slice(0, limit)
            .map((document) => ({
              id: document.id,
              data: (): Record<string, unknown> => document.data,
            }));
          return { docs: documents };
        },
        doc(id: string): ReturnType<SyntheticQuery['doc']> {
          return {
            async get(): Promise<{
              exists: boolean;
              data: () => Record<string, unknown> | undefined;
            }> {
              const document = (collections.get(name) ?? []).find((entry) => entry.id === id);
              return {
                exists: document !== undefined,
                data: (): Record<string, unknown> | undefined => document?.data,
              };
            },
          };
        },
      };
      return query;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function legacyDigest(id: string, overrides: Record<string, unknown> = {}): StoredDocument {
  return {
    id,
    data: {
      userId: 'user-owner',
      groupKey: FISHING_GROUP_KEY,
      date: '2026-07-03',
      summary: {
        date: '2026-07-03',
        groupKey: FISHING_GROUP_KEY,
        messageCount: 1,
        headline: 'Synthetic legacy summary',
      },
      generation: 1,
      generatedAt: '2026-07-03T03:05:00.000Z',
      modelId: 'synthetic-model',
      ...overrides,
    },
  };
}

function legacyState(id: string, overrides: Record<string, unknown> = {}): StoredDocument {
  return {
    id,
    data: {
      userId: 'user-owner',
      groupKey: FISHING_GROUP_KEY,
      date: '2026-07-03',
      state: { userId: 'user-owner', groupKey: FISHING_GROUP_KEY },
      ...overrides,
    },
  };
}

function chat(id: string, overrides: Record<string, unknown> = {}): StoredDocument {
  return {
    id,
    data: {
      userId: 'user-owner',
      sourceAccountId: 'source-active',
      generationId: 'generation-active',
      chatType: 'group',
      displayName: 'Grupa Wędkarska',
      ...overrides,
    },
  };
}
