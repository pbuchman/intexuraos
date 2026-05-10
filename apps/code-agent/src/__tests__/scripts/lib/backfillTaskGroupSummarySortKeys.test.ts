import { describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { runTaskGroupSummarySortKeyBackfill } from '../../../scripts/lib/backfillTaskGroupSummarySortKeys.js';

describe('backfillTaskGroupSummarySortKeys', () => {
  it('updates only legacy summaries that need repaired sort-key fields', async () => {
    const fakeFirestore = createFakeFirestore();
    await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-123').set({
      userId: 'user-1',
      groupKey: 'INT-123',
      linearIssueId: 'INT-123',
      linearIssueNumber: 999,
      linearIssueSortKey: 123,
    });
    await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-456').set({
      userId: 'user-1',
      groupKey: 'INT-456',
      linearIssueId: 'INT-456',
      linearIssueNumber: 456,
      linearIssueSortKey: 999,
    });
    await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-789').set({
      userId: 'user-1',
      groupKey: 'INT-789',
      linearIssueId: 'INT-789',
      linearIssueNumber: 789,
      linearIssueSortKey: 789,
    });

    const result = await runTaskGroupSummarySortKeyBackfill({
      firestore: fakeFirestore as unknown as Firestore,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updated).toBe(2);
    }

    const repairedNumberDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-123').get();
    const repairedSortKeyDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-456').get();
    const untouchedDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-789').get();

    expect(repairedNumberDoc.get('linearIssueNumber')).toBe(123);
    expect(repairedNumberDoc.get('linearIssueSortKey')).toBe(123);
    expect(repairedSortKeyDoc.get('linearIssueNumber')).toBe(456);
    expect(repairedSortKeyDoc.get('linearIssueSortKey')).toBe(456);
    expect(untouchedDoc.get('linearIssueNumber')).toBe(789);
    expect(untouchedDoc.get('linearIssueSortKey')).toBe(789);
  });

  it('supports dry-run mode and normalizes non-string linearIssueId values to null', async () => {
    const fakeFirestore = createFakeFirestore();
    await fakeFirestore.collection('task_group_summaries').doc('user-1_invalid').set({
      userId: 'user-1',
      groupKey: 'invalid',
      linearIssueId: 123,
      linearIssueNumber: 5,
      linearIssueSortKey: 5,
    });

    const result = await runTaskGroupSummarySortKeyBackfill({
      firestore: fakeFirestore as unknown as Firestore,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updated).toBe(1);
      expect(result.value.updates).toEqual([
        expect.objectContaining({
          linearIssueId: null,
          after: {
            linearIssueNumber: null,
            linearIssueSortKey: Number.MAX_SAFE_INTEGER,
          },
        }),
      ]);
    }

    const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_invalid').get();
    expect(doc.get('linearIssueNumber')).toBe(5);
    expect(doc.get('linearIssueSortKey')).toBe(5);
  });

  it('scans every summary across multiple pages before batching updates', async () => {
    const fakeFirestore = createFakeFirestore();
    await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-201').set({
      userId: 'user-1',
      groupKey: 'INT-201',
      linearIssueId: 'INT-201',
      linearIssueNumber: 1,
      linearIssueSortKey: 1,
    });
    await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-202').set({
      userId: 'user-1',
      groupKey: 'INT-202',
      linearIssueId: 'INT-202',
      linearIssueNumber: 2,
      linearIssueSortKey: 2,
    });
    await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-203').set({
      userId: 'user-1',
      groupKey: 'INT-203',
      linearIssueId: 'INT-203',
      linearIssueNumber: 3,
      linearIssueSortKey: 3,
    });

    const result = await runTaskGroupSummarySortKeyBackfill({
      firestore: fakeFirestore as unknown as Firestore,
      batchSize: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.scanned).toBe(3);
    expect(result.value.updated).toBe(3);
    expect((await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-203').get())
      .get('linearIssueNumber')).toBe(203);
  });

  it('returns an error when the Firestore scan fails', async () => {
    const firestore = {
      collection: vi.fn(() => {
        throw new Error('scan failed');
      }),
    } as unknown as Firestore;

    const result = await runTaskGroupSummarySortKeyBackfill({ firestore });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('scan failed');
    }
  });
});
