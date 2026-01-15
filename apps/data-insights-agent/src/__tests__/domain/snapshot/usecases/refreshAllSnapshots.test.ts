import { describe, it, expect, beforeEach } from 'vitest';
import { refreshAllSnapshots } from '../../../../domain/snapshot/usecases/refreshAllSnapshots.js';
import {
  FakeSnapshotRepository,
  FakeCompositeFeedRepository,
  FakeDataSourceRepository,
  FakeMobileNotificationsClient,
  FakeLogger,
} from '../../../fakes.js';

describe('refreshAllSnapshots', () => {
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeDataSourceRepo: FakeDataSourceRepository;
  let fakeMobileNotificationsClient: FakeMobileNotificationsClient;
  let fakeLogger: FakeLogger;

  beforeEach(() => {
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeDataSourceRepo = new FakeDataSourceRepository();
    fakeMobileNotificationsClient = new FakeMobileNotificationsClient();
    fakeLogger = new FakeLogger();
  });

  it('successfully refreshes all feeds', async () => {
    await fakeCompositeFeedRepo.create('user-1', 'Feed 1', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [],
    });

    await fakeCompositeFeedRepo.create('user-2', 'Feed 2', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [],
    });

    const result = await refreshAllSnapshots({
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      logger: fakeLogger,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.refreshed).toBe(2);
      expect(result.value.failed).toBe(0);
      expect(result.value.errors).toHaveLength(0);
    }
  });

  it('handles feeds with missing sources gracefully', async () => {
    await fakeCompositeFeedRepo.create('user-1', 'Feed 1', {
      purpose: 'Test purpose',
      staticSourceIds: ['missing-source'],
      notificationFilters: [],
    });

    await fakeCompositeFeedRepo.create('user-2', 'Feed 2', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [],
    });

    const result = await refreshAllSnapshots({
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      logger: fakeLogger,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.refreshed).toBe(2);
      expect(result.value.failed).toBe(0);
      expect(result.value.errors).toHaveLength(0);
    }
  });

  it('returns error when feed list fetch fails', async () => {
    fakeCompositeFeedRepo.setFailNextList(true);

    const result = await refreshAllSnapshots({
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      logger: fakeLogger,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Failed to list feeds');
    }
  });

  it('handles empty feed list', async () => {
    const result = await refreshAllSnapshots({
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      logger: fakeLogger,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.refreshed).toBe(0);
      expect(result.value.failed).toBe(0);
      expect(result.value.errors).toHaveLength(0);
    }
  });

  it('handles all feeds with missing sources gracefully', async () => {
    await fakeCompositeFeedRepo.create('user-1', 'Feed 1', {
      purpose: 'Test purpose',
      staticSourceIds: ['missing-1'],
      notificationFilters: [],
    });

    await fakeCompositeFeedRepo.create('user-2', 'Feed 2', {
      purpose: 'Test purpose',
      staticSourceIds: ['missing-2'],
      notificationFilters: [],
    });

    const result = await refreshAllSnapshots({
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      logger: fakeLogger,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.refreshed).toBe(2);
      expect(result.value.failed).toBe(0);
      expect(result.value.errors).toHaveLength(0);
    }
  });
});
