import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  indexes,
  metadata,
  removedCollectionGroups,
  removedRulePaths,
  up,
} from '../112_retire-obsolete-agent-firestore-artifacts.mjs'; // @allow-missing-js -- .mjs import

describe('migration 112 - retire obsolete agent Firestore artifacts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '112',
      name: 'retire-obsolete-agent-firestore-artifacts',
      createdAt: '2026-06-23',
    });
  });

  it('declares removed collection groups for generated artifact cleanup', () => {
    expect(removedCollectionGroups).toEqual([
      'todos',
      'doc_embeddings',
      'cron_schedules',
      'cron_executions',
    ]);
  });

  it('declares removed rules for generated artifact cleanup', () => {
    expect(removedRulePaths).toEqual(['doc_embeddings/{chunkId}']);
  });

  it('declares no new indexes', () => {
    expect(indexes).toEqual([]);
  });

  it('deploys regenerated indexes and rules', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const deployRules = vi.fn().mockResolvedValue(undefined);
    const context = {
      firestore: {},
      projectId: 'test-project',
      deployIndexes,
      deployRules,
    };

    await up(context);

    expect(deployIndexes).toHaveBeenCalledOnce();
    expect(deployRules).toHaveBeenCalledOnce();
  });
});
