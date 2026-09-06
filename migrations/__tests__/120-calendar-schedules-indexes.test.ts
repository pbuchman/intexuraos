import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collections, indexes, metadata, up } from '../120_calendar-schedules-indexes.mjs';

describe('migration 120 - calendar schedules indexes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '120',
      name: 'calendar-schedules-indexes',
    });
  });

  it('declares the calendar schedule collection groups', () => {
    expect(collections).toEqual(['calendar_schedules', 'calendar_schedule_runs']);
  });

  it('declares the expected composite indexes', () => {
    expect(indexes).toHaveLength(4);
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collectionGroup: 'calendar_schedules',
          fields: [
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'nextRunAt', order: 'ASCENDING' },
          ],
        }),
        expect.objectContaining({
          collectionGroup: 'calendar_schedules',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'taskType', order: 'ASCENDING' },
          ],
        }),
      ])
    );
  });

  it('deploys generated indexes', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const context = {
      firestore: {},
      projectId: 'test-project',
      deployIndexes,
      deployRules: vi.fn().mockResolvedValue(undefined),
    };

    await up(context);

    expect(deployIndexes).toHaveBeenCalledOnce();
  });
});
