/**
 * Fake repositories for data-insights-agent testing.
 *
 * These fakes implement domain port interfaces with in-memory storage.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  DataSource,
  DataSourceRepository,
  CreateDataSourceRequest,
  UpdateDataSourceRequest,
} from '../domain/dataSource/index.js';
import type {
  TitleGenerationService,
  TitleGenerationError,
} from '../infra/gemini/titleGenerationService.js';
import type {
  CompositeFeed,
  CompositeFeedRepository,
  CreateCompositeFeedRequest,
  UpdateCompositeFeedRequest,
  FeedNameGenerationService,
  NameGenerationError,
  MobileNotificationsClient,
  MobileNotificationItem,
  NotificationFilterConfig,
} from '../domain/compositeFeed/index.js';
import type { DataInsightSnapshot, SnapshotRepository } from '../domain/snapshot/index.js';
import type { CompositeFeedData } from '../domain/compositeFeed/schemas/index.js';
import { SNAPSHOT_TTL_MS } from '../domain/snapshot/models/index.js';

/**
 * Fake DataSource repository for testing.
 */
export class FakeDataSourceRepository implements DataSourceRepository {
  private dataSources = new Map<string, DataSource>();
  private idCounter = 1;
  private shouldFailCreate = false;
  private shouldFailGet = false;
  private shouldFailList = false;
  private shouldFailUpdate = false;
  private shouldFailDelete = false;

  setFailNextCreate(fail: boolean): void {
    this.shouldFailCreate = fail;
  }

  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  setFailNextList(fail: boolean): void {
    this.shouldFailList = fail;
  }

  setFailNextUpdate(fail: boolean): void {
    this.shouldFailUpdate = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  create(userId: string, request: CreateDataSourceRequest): Promise<Result<DataSource, string>> {
    if (this.shouldFailCreate) {
      this.shouldFailCreate = false;
      return Promise.resolve(err('Simulated create failure'));
    }

    const id = `ds-${String(this.idCounter++)}`;
    const now = new Date();
    const dataSource: DataSource = {
      id,
      userId,
      title: request.title,
      content: request.content,
      createdAt: now,
      updatedAt: now,
    };

    this.dataSources.set(id, dataSource);
    return Promise.resolve(ok(dataSource));
  }

  getById(id: string, userId: string): Promise<Result<DataSource | null, string>> {
    if (this.shouldFailGet) {
      this.shouldFailGet = false;
      return Promise.resolve(err('Simulated get failure'));
    }

    const dataSource = this.dataSources.get(id);
    if (dataSource === undefined || dataSource.userId !== userId) {
      return Promise.resolve(ok(null));
    }

    return Promise.resolve(ok(dataSource));
  }

  listByUserId(userId: string): Promise<Result<DataSource[], string>> {
    if (this.shouldFailList) {
      this.shouldFailList = false;
      return Promise.resolve(err('Simulated list failure'));
    }

    const dataSources = Array.from(this.dataSources.values())
      .filter((ds) => ds.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return Promise.resolve(ok(dataSources));
  }

  update(
    id: string,
    userId: string,
    request: UpdateDataSourceRequest
  ): Promise<Result<DataSource, string>> {
    if (this.shouldFailUpdate) {
      this.shouldFailUpdate = false;
      return Promise.resolve(err('Simulated update failure'));
    }

    const dataSource = this.dataSources.get(id);
    if (dataSource === undefined || dataSource.userId !== userId) {
      return Promise.resolve(err('Data source not found'));
    }

    const updated: DataSource = {
      ...dataSource,
      title: request.title ?? dataSource.title,
      content: request.content ?? dataSource.content,
      updatedAt: new Date(),
    };

    this.dataSources.set(id, updated);
    return Promise.resolve(ok(updated));
  }

  delete(id: string, userId: string): Promise<Result<void, string>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return Promise.resolve(err('Simulated delete failure'));
    }

    const dataSource = this.dataSources.get(id);
    if (dataSource === undefined || dataSource.userId !== userId) {
      return Promise.resolve(err('Data source not found'));
    }

    this.dataSources.delete(id);
    return Promise.resolve(ok(undefined));
  }

  clear(): void {
    this.dataSources.clear();
    this.idCounter = 1;
  }

  getAll(): DataSource[] {
    return Array.from(this.dataSources.values());
  }

  addDataSource(dataSource: DataSource): void {
    this.dataSources.set(dataSource.id, dataSource);
  }
}

/**
 * Fake TitleGenerationService for testing.
 */
export class FakeTitleGenerationService implements TitleGenerationService {
  private generatedTitle = 'Generated Test Title';
  private errorToReturn: TitleGenerationError | null = null;

  setGeneratedTitle(title: string): void {
    this.generatedTitle = title;
  }

  setError(error: TitleGenerationError | null): void {
    this.errorToReturn = error;
  }

  generateTitle(_userId: string, _content: string): Promise<Result<string, TitleGenerationError>> {
    if (this.errorToReturn !== null) {
      const error = this.errorToReturn;
      this.errorToReturn = null;
      return Promise.resolve(err(error));
    }
    return Promise.resolve(ok(this.generatedTitle));
  }
}

/**
 * Fake CompositeFeed repository for testing.
 */
export class FakeCompositeFeedRepository implements CompositeFeedRepository {
  private feeds = new Map<string, CompositeFeed>();
  private idCounter = 1;
  private shouldFailCreate = false;
  private shouldFailGet = false;
  private shouldFailList = false;
  private shouldFailUpdate = false;
  private shouldFailDelete = false;
  private shouldFailFindBySource = false;

  setFailNextCreate(fail: boolean): void {
    this.shouldFailCreate = fail;
  }

  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  setFailNextList(fail: boolean): void {
    this.shouldFailList = fail;
  }

  setFailNextUpdate(fail: boolean): void {
    this.shouldFailUpdate = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  setFailNextFindBySource(fail: boolean): void {
    this.shouldFailFindBySource = fail;
  }

  create(
    userId: string,
    name: string,
    request: CreateCompositeFeedRequest
  ): Promise<Result<CompositeFeed, string>> {
    if (this.shouldFailCreate) {
      this.shouldFailCreate = false;
      return Promise.resolve(err('Simulated create failure'));
    }

    const id = `cf-${String(this.idCounter++)}`;
    const now = new Date();
    const feed: CompositeFeed = {
      id,
      userId,
      name,
      purpose: request.purpose,
      staticSourceIds: request.staticSourceIds,
      notificationFilters: request.notificationFilters.map((f, idx) => ({
        ...f,
        id: `filter-${String(idx + 1)}`,
      })),
      dataInsights: null,
      createdAt: now,
      updatedAt: now,
    };

    this.feeds.set(id, feed);
    return Promise.resolve(ok(feed));
  }

  getById(id: string, userId: string): Promise<Result<CompositeFeed | null, string>> {
    if (this.shouldFailGet) {
      this.shouldFailGet = false;
      return Promise.resolve(err('Simulated get failure'));
    }

    const feed = this.feeds.get(id);
    if (feed === undefined || feed.userId !== userId) {
      return Promise.resolve(ok(null));
    }

    return Promise.resolve(ok(feed));
  }

  listByUserId(userId: string): Promise<Result<CompositeFeed[], string>> {
    if (this.shouldFailList) {
      this.shouldFailList = false;
      return Promise.resolve(err('Simulated list failure'));
    }

    const feeds = Array.from(this.feeds.values())
      .filter((f) => f.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return Promise.resolve(ok(feeds));
  }

  listAll(): Promise<Result<CompositeFeed[], string>> {
    if (this.shouldFailList) {
      this.shouldFailList = false;
      return Promise.resolve(err('Simulated list all failure'));
    }

    const feeds = Array.from(this.feeds.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    return Promise.resolve(ok(feeds));
  }

  update(
    id: string,
    userId: string,
    request: UpdateCompositeFeedRequest
  ): Promise<Result<CompositeFeed, string>> {
    if (this.shouldFailUpdate) {
      this.shouldFailUpdate = false;
      return Promise.resolve(err('Simulated update failure'));
    }

    const feed = this.feeds.get(id);
    if (feed === undefined || feed.userId !== userId) {
      return Promise.resolve(err('Composite feed not found'));
    }

    const updated: CompositeFeed = {
      ...feed,
      purpose: request.purpose ?? feed.purpose,
      staticSourceIds: request.staticSourceIds ?? feed.staticSourceIds,
      notificationFilters:
        request.notificationFilters?.map((f, idx) => ({
          ...f,
          id: `filter-${String(idx + 1)}`,
        })) ?? feed.notificationFilters,
      dataInsights:
        request.staticSourceIds !== undefined || request.notificationFilters !== undefined
          ? null
          : feed.dataInsights,
      updatedAt: new Date(),
    };

    this.feeds.set(id, updated);
    return Promise.resolve(ok(updated));
  }

  updateDataInsights(
    id: string,
    userId: string,
    dataInsights: CompositeFeed['dataInsights']
  ): Promise<Result<CompositeFeed, string>> {
    const feed = this.feeds.get(id);
    if (feed === undefined || feed.userId !== userId) {
      return Promise.resolve(err('Composite feed not found'));
    }

    const updated: CompositeFeed = {
      ...feed,
      dataInsights,
      updatedAt: new Date(),
    };

    this.feeds.set(id, updated);
    return Promise.resolve(ok(updated));
  }

  delete(id: string, userId: string): Promise<Result<void, string>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return Promise.resolve(err('Simulated delete failure'));
    }

    const feed = this.feeds.get(id);
    if (feed === undefined || feed.userId !== userId) {
      return Promise.resolve(err('Composite feed not found'));
    }

    this.feeds.delete(id);
    return Promise.resolve(ok(undefined));
  }

  findByStaticSourceId(
    userId: string,
    staticSourceId: string
  ): Promise<Result<CompositeFeed[], string>> {
    if (this.shouldFailFindBySource) {
      this.shouldFailFindBySource = false;
      return Promise.resolve(err('Simulated findByStaticSourceId failure'));
    }

    const feeds = Array.from(this.feeds.values()).filter(
      (f) => f.userId === userId && f.staticSourceIds.includes(staticSourceId)
    );

    return Promise.resolve(ok(feeds));
  }

  clear(): void {
    this.feeds.clear();
    this.idCounter = 1;
  }

  getAll(): CompositeFeed[] {
    return Array.from(this.feeds.values());
  }

  addFeed(feed: CompositeFeed): void {
    this.feeds.set(feed.id, feed);
  }
}

/**
 * Fake FeedNameGenerationService for testing.
 */
export class FakeFeedNameGenerationService implements FeedNameGenerationService {
  private generatedName = 'Generated Feed Name';
  private errorToReturn: NameGenerationError | null = null;

  setGeneratedName(name: string): void {
    this.generatedName = name;
  }

  setError(error: NameGenerationError | null): void {
    this.errorToReturn = error;
  }

  generateName(
    _userId: string,
    _purpose: string,
    _sourceNames: string[],
    _filterNames: string[]
  ): Promise<Result<string, NameGenerationError>> {
    if (this.errorToReturn !== null) {
      const error = this.errorToReturn;
      this.errorToReturn = null;
      return Promise.resolve(err(error));
    }
    return Promise.resolve(ok(this.generatedName));
  }
}

/**
 * Fake MobileNotificationsClient for testing.
 */
export class FakeMobileNotificationsClient implements MobileNotificationsClient {
  private notifications: MobileNotificationItem[] = [];
  private errorToReturn: string | null = null;

  setNotifications(notifications: MobileNotificationItem[]): void {
    this.notifications = notifications;
  }

  setError(error: string | null): void {
    this.errorToReturn = error;
  }

  queryNotifications(
    _userId: string,
    _filter: NotificationFilterConfig
  ): Promise<Result<MobileNotificationItem[], string>> {
    if (this.errorToReturn !== null) {
      const error = this.errorToReturn;
      this.errorToReturn = null;
      return Promise.resolve(err(error));
    }
    return Promise.resolve(ok(this.notifications));
  }
}

/**
 * Fake Snapshot repository for testing.
 */
export class FakeSnapshotRepository implements SnapshotRepository {
  private snapshots = new Map<string, DataInsightSnapshot>();
  private shouldFailGet = false;
  private shouldFailUpsert = false;
  private shouldFailDelete = false;
  private shouldFailList = false;

  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  setFailNextUpsert(fail: boolean): void {
    this.shouldFailUpsert = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  setFailNextList(fail: boolean): void {
    this.shouldFailList = fail;
  }

  clear(): void {
    this.snapshots.clear();
  }

  getByFeedId(feedId: string, userId: string): Promise<Result<DataInsightSnapshot | null, string>> {
    if (this.shouldFailGet) {
      this.shouldFailGet = false;
      return Promise.resolve(err('Simulated get failure'));
    }

    const snapshot = this.snapshots.get(feedId);
    if (snapshot === undefined || snapshot.userId !== userId) {
      return Promise.resolve(ok(null));
    }

    return Promise.resolve(ok(snapshot));
  }

  upsert(
    feedId: string,
    userId: string,
    feedName: string,
    data: CompositeFeedData
  ): Promise<Result<DataInsightSnapshot, string>> {
    if (this.shouldFailUpsert) {
      this.shouldFailUpsert = false;
      return Promise.resolve(err('Simulated upsert failure'));
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS);

    const snapshot: DataInsightSnapshot = {
      id: feedId,
      userId,
      feedId,
      feedName,
      data,
      generatedAt: now,
      expiresAt,
    };

    this.snapshots.set(feedId, snapshot);
    return Promise.resolve(ok(snapshot));
  }

  delete(feedId: string, userId: string): Promise<Result<void, string>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return Promise.resolve(err('Simulated delete failure'));
    }

    const snapshot = this.snapshots.get(feedId);
    if (snapshot !== undefined && snapshot.userId === userId) {
      this.snapshots.delete(feedId);
    }

    return Promise.resolve(ok(undefined));
  }

  deleteByFeedId(feedId: string): Promise<Result<void, string>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return Promise.resolve(err('Simulated delete by feed ID failure'));
    }

    this.snapshots.delete(feedId);
    return Promise.resolve(ok(undefined));
  }

  listByUserId(userId: string): Promise<Result<DataInsightSnapshot[], string>> {
    if (this.shouldFailList) {
      this.shouldFailList = false;
      return Promise.resolve(err('Simulated list failure'));
    }

    const snapshots = Array.from(this.snapshots.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());

    return Promise.resolve(ok(snapshots));
  }
}
