import { describe, it, expect, beforeEach } from 'vitest';
import { refreshVisualizationsForFeed } from '../refreshVisualizationsForFeed.js';
import {
  FakeVisualizationRepository,
  FakeVisualizationGenerationService,
  FakeSnapshotRepository,
} from '../../../../__tests__/fakes.js';

describe('refreshVisualizationsForFeed', () => {
  let fakeVisualizationRepo: FakeVisualizationRepository;
  let fakeVisualizationGenerationService: FakeVisualizationGenerationService;
  let fakeSnapshotRepo: FakeSnapshotRepository;

  beforeEach(() => {
    fakeVisualizationRepo = new FakeVisualizationRepository();
    fakeVisualizationGenerationService = new FakeVisualizationGenerationService();
    fakeSnapshotRepo = new FakeSnapshotRepository();
  });

  describe('success cases', () => {
    it('refreshes all ready visualizations', async () => {
      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const viz1Result = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Viz 1',
        description: 'First viz',
        type: 'chart',
      });
      const viz1 = viz1Result.ok ? viz1Result.value : null;

      const viz2Result = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Viz 2',
        description: 'Second viz',
        type: 'table',
      });
      const viz2 = viz2Result.ok ? viz2Result.value : null;

      await fakeVisualizationRepo.update(viz1?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
        htmlContent: '<html>Old content 1</html>',
      });

      await fakeVisualizationRepo.update(viz2?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
        htmlContent: '<html>Old content 2</html>',
      });

      fakeVisualizationGenerationService.setGeneratedHtml('<html>New content</html>');

      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(2);
        expect(result.value.succeeded).toBe(2);
        expect(result.value.failed).toBe(0);
        expect(result.value.errors).toHaveLength(0);
      }
    });

    it('skips pending visualizations', async () => {
      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const viz1Result = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Ready Viz',
        description: 'Will be refreshed',
        type: 'chart',
      });
      const viz1 = viz1Result.ok ? viz1Result.value : null;

      await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Pending Viz',
        description: 'Will be skipped',
        type: 'table',
      });

      await fakeVisualizationRepo.update(viz1?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
        htmlContent: '<html>Old content</html>',
      });

      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(1);
        expect(result.value.succeeded).toBe(1);
        expect(result.value.failed).toBe(0);
      }
    });

    it('skips error visualizations', async () => {
      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const viz1Result = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Ready Viz',
        description: 'Will be refreshed',
        type: 'chart',
      });
      const viz1 = viz1Result.ok ? viz1Result.value : null;

      const viz2Result = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Error Viz',
        description: 'Will be skipped',
        type: 'table',
      });
      const viz2 = viz2Result.ok ? viz2Result.value : null;

      await fakeVisualizationRepo.update(viz1?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
        htmlContent: '<html>Old content</html>',
      });

      await fakeVisualizationRepo.update(viz2?.id ?? '', 'feed-1', 'user-123', {
        status: 'error',
        errorMessage: 'Previous error',
      });

      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(1);
        expect(result.value.succeeded).toBe(1);
        expect(result.value.failed).toBe(0);
      }
    });

    it('returns empty result when no visualizations exist', async () => {
      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(0);
        expect(result.value.succeeded).toBe(0);
        expect(result.value.failed).toBe(0);
        expect(result.value.errors).toHaveLength(0);
      }
    });

    it('returns empty result when no ready visualizations exist', async () => {
      await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Pending Viz',
        description: 'Still pending',
        type: 'chart',
      });

      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(0);
        expect(result.value.succeeded).toBe(0);
        expect(result.value.failed).toBe(0);
      }
    });
  });

  describe('partial failures', () => {
    it('continues refreshing after individual failures', async () => {
      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const viz1Result = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Viz 1',
        description: 'Will succeed',
        type: 'chart',
      });
      const viz1 = viz1Result.ok ? viz1Result.value : null;

      const viz2Result = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Viz 2',
        description: 'Will fail',
        type: 'table',
      });
      const viz2 = viz2Result.ok ? viz2Result.value : null;

      const viz3Result = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Viz 3',
        description: 'Will succeed',
        type: 'summary',
      });
      const viz3 = viz3Result.ok ? viz3Result.value : null;

      await fakeVisualizationRepo.update(viz1?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
      });
      await fakeVisualizationRepo.update(viz2?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
      });
      await fakeVisualizationRepo.update(viz3?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
      });

      let callCount = 0;
      const originalGenerate =
        fakeVisualizationGenerationService.generateContent.bind(
          fakeVisualizationGenerationService
        );
      fakeVisualizationGenerationService.generateContent = async (
        snapshotData: object,
        request: {
          visualizationId: string;
          feedId: string;
          userId: string;
          title: string;
          description: string;
          type: 'chart' | 'table' | 'summary' | 'custom';
        }
      ): Promise<{ htmlContent: string }> => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Simulated generation failure for viz 2');
        }
        return originalGenerate(snapshotData, request);
      };

      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(3);
        expect(result.value.succeeded).toBe(2);
        expect(result.value.failed).toBe(1);
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]?.visualizationId).toBe(viz2?.id);
      }
    });

    it('includes error details in result', async () => {
      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Viz 1',
        description: 'Will fail',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      await fakeVisualizationRepo.update(viz?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
      });

      fakeVisualizationGenerationService.setFailNextGeneration(true);

      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(1);
        expect(result.value.succeeded).toBe(0);
        expect(result.value.failed).toBe(1);
        expect(result.value.errors[0]?.visualizationId).toBe(viz?.id);
        expect(result.value.errors[0]?.error).toBeTruthy();
      }
    });
  });

  describe('repository errors', () => {
    it('returns empty result when listing visualizations fails', async () => {
      fakeVisualizationRepo.setFailNextList(true);

      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(0);
        expect(result.value.succeeded).toBe(0);
        expect(result.value.failed).toBe(0);
      }
    });
  });

  describe('logging', () => {
    it('calls logger when provided', async () => {
      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      await fakeVisualizationRepo.update(viz?.id ?? '', 'feed-1', 'user-123', {
        status: 'ready',
      });

      const logCalls: string[] = [];
      const logger = {
        info: (_obj: object, msg: string): void => {
          logCalls.push(`info: ${msg}`);
        },
        warn: (_obj: object, msg: string): void => {
          logCalls.push(`warn: ${msg}`);
        },
        error: (_obj: object, msg: string): void => {
          logCalls.push(`error: ${msg}`);
        },
      };

      await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
        logger,
      });

      expect(logCalls.length).toBeGreaterThan(0);
      expect(logCalls.some((call) => call.includes('Refreshing visualizations for feed'))).toBe(true);
    });

    it('works without logger', async () => {
      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles visualization from different user', async () => {
      await fakeVisualizationRepo.create('feed-1', 'other-user', {
        title: 'Other User Viz',
        description: 'Should not be refreshed',
        type: 'chart',
      });

      const result = await refreshVisualizationsForFeed('feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(0);
      }
    });
  });
});
