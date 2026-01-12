import { describe, it, expect, beforeEach } from 'vitest';
import { refreshSnapshot } from '../../../../domain/snapshot/usecases/refreshSnapshot.js';
import {
  FakeSnapshotRepository,
  FakeCompositeFeedRepository,
  FakeDataSourceRepository,
  FakeMobileNotificationsClient,
} from '../../../fakes.js';

describe('refreshSnapshot', () => {
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeDataSourceRepo: FakeDataSourceRepository;
  let fakeMobileNotificationsClient: FakeMobileNotificationsClient;

  beforeEach(() => {
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeDataSourceRepo = new FakeDataSourceRepository();
    fakeMobileNotificationsClient = new FakeMobileNotificationsClient();
  });

  it('successfully refreshes snapshot for feed with static sources', async () => {
    const sourceResult = await fakeDataSourceRepo.create('user-123', {
      title: 'Test Source',
      content: 'Test content',
    });

    expect(sourceResult.ok).toBe(true);
    const source = sourceResult.ok ? sourceResult.value : null;

    const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
      purpose: 'Test purpose',
      staticSourceIds: [source?.id ?? ''],
      notificationFilters: [],
    });

    expect(feedResult.ok).toBe(true);

    const feed = feedResult.ok ? feedResult.value : null;
    const result = await refreshSnapshot(feed?.id ?? '', 'user-123', {
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.staticSources).toHaveLength(1);
      expect(result.value.data.staticSources[0]?.id).toBe(source?.id);
      expect(result.value.data.notifications).toHaveLength(0);
    }
  });

  it('successfully refreshes snapshot for feed with notification filters', async () => {
    const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [],
    });

    expect(feedResult.ok).toBe(true);
    const feed = feedResult.ok ? feedResult.value : null;

    const result = await refreshSnapshot(feed?.id ?? '', 'user-123', {
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.staticSources).toHaveLength(0);
      expect(result.value.data.notifications).toHaveLength(0);
    }
  });
});
