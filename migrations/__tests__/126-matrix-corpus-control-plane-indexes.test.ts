import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collections, indexes, metadata, up } from '../126_matrix-corpus-control-plane-indexes.mjs'; // @allow-missing-js -- .mjs import

const expectedIndexes = [
  {
    collectionGroup: 'matrix_corpus_ingest_outbox',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'matrix_corpus_ingest_outbox',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'claim.expiresAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'matrix_corpus_terminal_control_outbox',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'matrix_corpus_terminal_control_outbox',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'claim.expiresAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'matrix_corpus_run_leases',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'phase', order: 'ASCENDING' },
      { fieldPath: 'expiresAt', order: 'ASCENDING' },
    ],
  },
] as const;

const expectedOwners = {
  matrix_corpus_run_leases: 'whatsapp-service',
  matrix_corpus_capabilities: 'whatsapp-service',
  matrix_corpus_ingest_outbox: 'whatsapp-service',
  matrix_corpus_terminal_control_outbox: 'whatsapp-service',
  matrix_corpus_transport_receipts: 'whatsapp-service',
  intex_agent_matrix_corpus_ingest_receipts: 'intex-agent',
  intex_agent_matrix_corpus_test_confirmations: 'intex-agent',
  intex_agent_matrix_corpus_run_manifests: 'intex-agent',
  intex_agent_matrix_corpus_run_contexts: 'intex-agent',
  intex_agent_matrix_corpus_scenario_contexts: 'intex-agent',
  intex_agent_test_runs: 'intex-agent',
  intex_agent_test_run_scenarios: 'intex-agent',
} as const;

describe('migration 126 - Matrix corpus control-plane indexes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('declares only the five indexes required by bounded recovery queries', () => {
    expect(metadata).toEqual({
      id: '126',
      name: 'matrix-corpus-control-plane-indexes',
      description: 'Indexes for bounded Matrix corpus outbox and expired-lease recovery',
      createdAt: '2026-07-20',
    });
    expect(collections).toEqual([
      'matrix_corpus_ingest_outbox',
      'matrix_corpus_terminal_control_outbox',
      'matrix_corpus_run_leases',
    ]);
    expect(indexes).toEqual(expectedIndexes);
  });

  it('maps each recovery predicate and order to exactly one index', () => {
    const queryMappings = [
      ['ingest pending ordered by creation', expectedIndexes[0]],
      ['ingest expired claim ordered by claim expiry', expectedIndexes[1]],
      ['terminal pending ordered by creation', expectedIndexes[2]],
      ['terminal expired claim ordered by claim expiry', expectedIndexes[3]],
      ['nonterminal lease ordered by expiry', expectedIndexes[4]],
    ] as const;

    for (const [queryName, expectedIndex] of queryMappings) {
      expect(
        indexes.filter((index) => JSON.stringify(index) === JSON.stringify(expectedIndex)),
        queryName
      ).toHaveLength(1);
    }
  });

  it('registers every Matrix corpus collection under exactly one owner', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../../firestore-collections.json', import.meta.url), 'utf8')
    ) as { collections: Record<string, { owner: string }> };

    for (const [collection, owner] of Object.entries(expectedOwners)) {
      expect(registry.collections[collection]?.owner, collection).toBe(owner);
    }
  });

  it('deploys the generated aggregate index artifact', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
  });

  it('propagates index deployment failures', async () => {
    const deployIndexes = vi.fn().mockRejectedValue(new Error('deploy failed'));

    await expect(up({ deployIndexes })).rejects.toThrow('deploy failed');
    expect(deployIndexes).toHaveBeenCalledOnce();
  });
});
