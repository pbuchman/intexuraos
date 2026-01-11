import { describe, it, expect, beforeEach, vi } from 'vitest';
import { refreshSnapshot } from '../../../../domain/snapshot/usecases/refreshSnapshot.js';
import {
  FakeSnapshotRepository,
  FakeCompositeFeedRepository,
  FakeDataSourceRepository,
  FakeMobileNotificationsClient,
  FakeVisualizationRepository,
  FakeVisualizationGenerationService,
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
      expect(result.value.feedName).toBe('Test Feed');
      expect(result.value.data.staticSources).toHaveLength(1);
      expect(result.value.data.staticSources[0]?.name).toBe('Test Source');
    }
  });

  it('successfully refreshes snapshot for feed with notification filters', async () => {
    const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [
        {
          id: 'filter-1',
          name: 'Apps',
          app: ['com.example.app'],
        },
      ],
    });

    fakeMobileNotificationsClient.setNotifications([
      {
        id: 'notif-1',
        app: 'com.example.app',
        title: 'Test Notification',
        body: 'Test text',
        timestamp: '2026-01-09T12:00:00.000Z',
      },
    ]);

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
      expect(result.value.data.notifications).toHaveLength(1);
      expect(result.value.data.notifications[0]?.items).toHaveLength(1);
    }
  });

  it('returns FEED_NOT_FOUND when feed does not exist', async () => {
    const result = await refreshSnapshot('feed-123', 'user-123', {
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FEED_NOT_FOUND');
    }
  });

  it('returns REPOSITORY_ERROR when feed repository fails', async () => {
    fakeCompositeFeedRepo.setFailNextGet(true);

    const result = await refreshSnapshot('feed-123', 'user-123', {
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('REPOSITORY_ERROR');
    }
  });

  it('handles missing data sources gracefully', async () => {
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
    fakeDataSourceRepo.setFailNextGet(true);

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
    }
  });

  it('returns REPOSITORY_ERROR when snapshot upsert fails', async () => {
    const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [],
    });

    expect(feedResult.ok).toBe(true);
    fakeSnapshotRepo.setFailNextUpsert(true);

    const feed = feedResult.ok ? feedResult.value : null;
    const result = await refreshSnapshot(feed?.id ?? '', 'user-123', {
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('REPOSITORY_ERROR');
    }
  });

  it('handles feed with no static sources or notification filters', async () => {
    const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Empty Feed', {
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

  it('triggers visualization refresh when requested', async () => {
    const fakeVisualizationRepo = new FakeVisualizationRepository();
    const fakeVisualizationService = new FakeVisualizationGenerationService();
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [],
    });

    expect(feedResult.ok).toBe(true);
    const feed = feedResult.ok ? feedResult.value : null;

    await fakeVisualizationRepo.create(feed?.id ?? '', 'user-123', {
      title: 'Test Viz',
      description: 'Test desc',
      type: 'chart',
    });

    const result = await refreshSnapshot(feed?.id ?? '', 'user-123', {
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      visualizationRepository: fakeVisualizationRepo,
      visualizationGenerationService: fakeVisualizationService,
      refreshVisualizations: true,
      logger: mockLogger,
    });

    expect(result.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ feedId: feed?.id }),
      'Starting visualization refresh'
    );
  });

  it('does not trigger visualization refresh when not requested', async () => {
    const fakeVisualizationRepo = new FakeVisualizationRepository();
    const fakeVisualizationService = new FakeVisualizationGenerationService();
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [],
    });

    expect(feedResult.ok).toBe(true);
    const feed = feedResult.ok ? feedResult.value : null;

    await refreshSnapshot(feed?.id ?? '', 'user-123', {
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      visualizationRepository: fakeVisualizationRepo,
      visualizationGenerationService: fakeVisualizationService,
      refreshVisualizations: false,
      logger: mockLogger,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const startVisualizationCalls = mockLogger.info.mock.calls.filter((call) =>
      String(call[1]).includes('Starting visualization refresh')
    );
    expect(startVisualizationCalls).toHaveLength(0);
  });

  it('does not refresh visualizations when missing dependencies', async () => {
    const fakeVisualizationRepo = new FakeVisualizationRepository();
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

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
      visualizationRepository: fakeVisualizationRepo,
      refreshVisualizations: true,
      logger: mockLogger,
    });

    expect(result.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const visualizationRefreshCalls = mockLogger.info.mock.calls.filter((call) =>
      String(call[1]).includes('Starting visualization refresh')
    );
    expect(visualizationRefreshCalls).toHaveLength(0);
  });
});
