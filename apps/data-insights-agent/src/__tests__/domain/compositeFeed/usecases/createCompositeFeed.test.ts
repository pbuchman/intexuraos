import { describe, it, expect, beforeEach } from 'vitest';
import { createCompositeFeed } from '../../../../domain/compositeFeed/usecases/createCompositeFeed.js';
import {
  FakeCompositeFeedRepository,
  FakeDataSourceRepository,
  FakeFeedNameGenerationService,
  FakeLogger,
} from '../../../fakes.js';

describe('createCompositeFeed', () => {
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeDataSourceRepo: FakeDataSourceRepository;
  let fakeFeedNameService: FakeFeedNameGenerationService;
  let fakeLogger: FakeLogger;

  beforeEach(() => {
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeDataSourceRepo = new FakeDataSourceRepository();
    fakeFeedNameService = new FakeFeedNameGenerationService();
    fakeLogger = new FakeLogger();
  });

  describe('success paths', () => {
    it('creates composite feed successfully', async () => {
      const dataSourceResult = await fakeDataSourceRepo.create('user-123', {
        title: 'Test Source',
        content: 'Test content',
      });
      expect(dataSourceResult.ok).toBe(true);
      const dataSource = dataSourceResult.ok ? dataSourceResult.value : null;

      fakeFeedNameService.setGeneratedName('AI Generated Feed Name');

      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: 'Test purpose',
          staticSourceIds: [dataSource?.id ?? ''],
          notificationFilters: [],
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('AI Generated Feed Name');
        expect(result.value.purpose).toBe('Test purpose');
      }
    });

    it('creates composite feed with multiple sources and filters', async () => {
      const source1Result = await fakeDataSourceRepo.create('user-123', {
        title: 'Source 1',
        content: 'Content 1',
      });
      const source2Result = await fakeDataSourceRepo.create('user-123', {
        title: 'Source 2',
        content: 'Content 2',
      });
      expect(source1Result.ok).toBe(true);
      expect(source2Result.ok).toBe(true);

      fakeFeedNameService.setGeneratedName('Multi-Source Feed');

      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: 'Aggregate multiple sources',
          staticSourceIds: [
            source1Result.ok ? source1Result.value.id : '',
            source2Result.ok ? source2Result.value.id : '',
          ],
          notificationFilters: [
            { id: 'filter-1', name: 'Filter 1', app: ['test'], source: 'test', title: 'test' },
          ],
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('validation errors', () => {
    it('returns VALIDATION_ERROR when static sources exceed maximum', async () => {
      // Create 11 data sources (more than MAX_STATIC_SOURCES which is 10)
      const sourceIds = ['ds-1', 'ds-2', 'ds-3', 'ds-4', 'ds-5', 'ds-6', 'ds-7', 'ds-8', 'ds-9', 'ds-10', 'ds-11'];

      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: 'Test purpose',
          staticSourceIds: sourceIds,
          notificationFilters: [],
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('Maximum');
        expect(result.error.message).toContain('static sources allowed');
      }
    });

    it('returns VALIDATION_ERROR when notification filters exceed maximum', async () => {
      const filters = Array.from({ length: 11 }, (_, i) => ({
        id: `filter-${String(i)}`,
        name: `Filter ${String(i)}`,
        app: ['test'],
        source: 'test',
        title: 'test',
      }));

      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: 'Test purpose',
          staticSourceIds: [],
          notificationFilters: filters,
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('Maximum');
        expect(result.error.message).toContain('notification filters allowed');
      }
    });

    it('returns VALIDATION_ERROR when purpose is empty', async () => {
      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: '   ',  // whitespace only
          staticSourceIds: [],
          notificationFilters: [],
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toBe('Purpose is required');
      }
    });
  });

  describe('error paths', () => {
    it('returns SOURCE_NOT_FOUND when data source does not exist', async () => {
      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: 'Test purpose',
          staticSourceIds: ['non-existent-source'],
          notificationFilters: [],
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SOURCE_NOT_FOUND');
        expect(result.error.message).toContain('Data source not found');
      }
    });

    it('returns REPOSITORY_ERROR when data source repository fails', async () => {
      fakeDataSourceRepo.setFailNextGet(true);

      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: 'Test purpose',
          staticSourceIds: ['some-source'],
          notificationFilters: [],
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });

    it('returns NAME_GENERATION_ERROR when feed name generation fails', async () => {
      const dataSourceResult = await fakeDataSourceRepo.create('user-123', {
        title: 'Test Source',
        content: 'Test content',
      });
      expect(dataSourceResult.ok).toBe(true);

      fakeFeedNameService.setError({
        code: 'GENERATION_ERROR',
        message: 'Rate limit exceeded',
      });

      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: 'Test purpose',
          staticSourceIds: [dataSourceResult.ok ? dataSourceResult.value.id : ''],
          notificationFilters: [],
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NAME_GENERATION_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });

    it('returns REPOSITORY_ERROR when composite feed repository fails on create', async () => {
      const dataSourceResult = await fakeDataSourceRepo.create('user-123', {
        title: 'Test Source',
        content: 'Test content',
      });
      expect(dataSourceResult.ok).toBe(true);

      fakeFeedNameService.setGeneratedName('Test Feed');
      fakeCompositeFeedRepo.setFailNextCreate(true);

      const result = await createCompositeFeed(
        'user-123',
        {
          purpose: 'Test purpose',
          staticSourceIds: [dataSourceResult.ok ? dataSourceResult.value.id : ''],
          notificationFilters: [],
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          dataSourceRepository: fakeDataSourceRepo,
          feedNameGenerationService: fakeFeedNameService,
          logger: fakeLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });
  });
});
