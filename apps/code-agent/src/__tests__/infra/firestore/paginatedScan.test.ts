import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';
import { paginatedScan } from '../../../infra/firestore/paginatedScan.js';

describe('paginatedScan', () => {
  async function collectIds(
    iterable: AsyncIterable<{ id: string }>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for await (const doc of iterable) {
      ids.push(doc.id);
    }
    return ids;
  }

  it('walks every matching document across multiple documentId-ordered pages', async () => {
    const fakeFirestore = createFakeFirestore();
    const firestore = fakeFirestore as unknown as Firestore;

    await fakeFirestore.collection('code_tasks').doc('task-c').set({ status: 'queued' });
    await fakeFirestore.collection('code_tasks').doc('task-a').set({ status: 'queued' });
    await fakeFirestore.collection('code_tasks').doc('task-d').set({ status: 'done' });
    await fakeFirestore.collection('code_tasks').doc('task-b').set({ status: 'queued' });

    const ids = await collectIds(paginatedScan(
      firestore.collection('code_tasks').where('status', '==', 'queued'),
      { batchSize: 2 },
    ));

    expect(ids).toEqual(['task-a', 'task-b', 'task-c']);
  });

  it('returns no documents when the query is empty', async () => {
    const fakeFirestore = createFakeFirestore();
    const firestore = fakeFirestore as unknown as Firestore;

    const ids = await collectIds(paginatedScan(
      firestore.collection('code_tasks').where('status', '==', 'queued'),
      { batchSize: 2 },
    ));

    expect(ids).toEqual([]);
  });

  it('rejects non-positive batch sizes', async () => {
    const fakeFirestore = createFakeFirestore();
    const firestore = fakeFirestore as unknown as Firestore;

    await expect(collectIds(paginatedScan(
      firestore.collection('code_tasks').where('status', '==', 'queued'),
      { batchSize: 0 },
    ))).rejects.toThrow('Invalid paginated scan batch size: 0');
  });
});
