import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  indexes,
  metadata,
  removedCollectionGroups,
  removedRulePaths,
  up,
} from '../116_remove-command-action-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 116 - remove command/action Firestore artifacts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '116',
      name: 'remove-command-action-indexes',
      createdAt: '2026-06-24',
    });
  });

  it('declares removed collection groups for generated artifact cleanup', () => {
    expect(removedCollectionGroups).toEqual([
      'commands',
      'actions',
      'actions_transitions',
      'approval_messages',
    ]);
  });

  it('declares removed rules for generated artifact cleanup', () => {
    expect(removedRulePaths).toEqual(['commands/{commandId}', 'actions/{actionId}']);
  });

  it('declares no new indexes', () => {
    expect(indexes).toEqual([]);
  });

  it('deploys regenerated indexes and rules', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const deployRules = vi.fn().mockResolvedValue(undefined);

    await up({ deployIndexes, deployRules });

    expect(deployIndexes).toHaveBeenCalledOnce();
    expect(deployRules).toHaveBeenCalledOnce();
  });
});
