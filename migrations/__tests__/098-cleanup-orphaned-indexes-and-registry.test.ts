import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  indexes,
  metadata,
  removedCollectionGroups,
  up,
} from '../098_cleanup-orphaned-indexes-and-registry.mjs'; // @allow-missing-js -- .mjs import

describe('migration 098 – cleanup orphaned indexes and registry reconcile', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '098',
      name: 'cleanup-orphaned-indexes-and-registry',
    });
    expect(metadata.description).toBeDefined();
    expect(metadata.createdAt).toBe('2026-04-25');
  });

  it('declares all confirmed orphan collection groups for removal', () => {
    const expectedOrphans = [
      'compositeFeeds',
      'composite_feeds',
      'composite_feed_snapshots',
      'custom_data_sources',
      'dataSource',
      'visualizations',
      'by_user',
    ];

    for (const orphan of expectedOrphans) {
      expect(removedCollectionGroups).toContain(orphan);
    }
  });

  it('declares no new indexes (cleanup-only migration)', () => {
    expect(indexes).toEqual([]);
  });

  it('deploys indexes via context.deployIndexes', async () => {
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
  });

  it('does not deploy rules (indexes-only cleanup)', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const deployRules = vi.fn().mockResolvedValue(undefined);
    const context = {
      firestore: {},
      projectId: 'test-project',
      deployIndexes,
      deployRules,
    };

    await up(context);

    expect(deployRules).not.toHaveBeenCalled();
  });
});
