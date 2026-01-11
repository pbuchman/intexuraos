import { describe, it, expect, beforeEach } from 'vitest';
import { generateVisualizationContent } from '../generateVisualizationContent.js';
import {
  FakeVisualizationRepository,
  FakeVisualizationGenerationService,
  FakeSnapshotRepository,
} from '../../../../__tests__/fakes.js';

describe('generateVisualizationContent', () => {
  let fakeVisualizationRepo: FakeVisualizationRepository;
  let fakeVisualizationGenerationService: FakeVisualizationGenerationService;
  let fakeSnapshotRepo: FakeSnapshotRepository;

  beforeEach(() => {
    fakeVisualizationRepo = new FakeVisualizationRepository();
    fakeVisualizationGenerationService = new FakeVisualizationGenerationService();
    fakeSnapshotRepo = new FakeSnapshotRepository();
  });

  describe('success cases', () => {
    it('generates visualization content successfully', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      fakeVisualizationGenerationService.setGeneratedHtml(
        '<html><body><h1>Generated Content</h1></body></html>'
      );

      const result = await generateVisualizationContent(viz?.id ?? '', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);

      const updatedViz = await fakeVisualizationRepo.getById(viz?.id ?? '', 'feed-1', 'user-123');
      expect(updatedViz.ok && updatedViz.value?.status).toBe('ready');
      expect(updatedViz.ok && updatedViz.value?.htmlContent).toBe(
        '<html><body><h1>Generated Content</h1></body></html>'
      );
      expect(updatedViz.ok && updatedViz.value?.errorMessage).toBe(null);
      expect(updatedViz.ok && updatedViz.value?.lastGeneratedAt).not.toBe(null);
    });

    it('updates lastGeneratedAt timestamp', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const beforeTime = new Date();
      await generateVisualizationContent(viz?.id ?? '', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });
      const afterTime = new Date();

      const updatedViz = await fakeVisualizationRepo.getById(viz?.id ?? '', 'feed-1', 'user-123');
      expect(updatedViz.ok && updatedViz.value?.lastGeneratedAt).not.toBe(null);
      const lastGenerated = updatedViz.ok && updatedViz.value?.lastGeneratedAt;
      if (lastGenerated !== null && lastGenerated !== false && lastGenerated !== undefined) {
        expect(lastGenerated.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
        expect(lastGenerated.getTime()).toBeLessThanOrEqual(afterTime.getTime());
      }
    });
  });

  describe('not found errors', () => {
    it('returns error when visualization not found', async () => {
      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const result = await generateVisualizationContent('non-existent', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('Visualization not found');
      }
    });

    it('returns error when snapshot not found', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      const result = await generateVisualizationContent(viz?.id ?? '', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('Snapshot not found');
      }
    });
  });

  describe('generation errors', () => {
    it('returns error when generation fails', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      fakeVisualizationGenerationService.setFailNextGeneration(true);

      const result = await generateVisualizationContent(viz?.id ?? '', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
      }
    });

    it('updates visualization status to error when generation fails', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      fakeVisualizationGenerationService.setFailNextGeneration(true);

      await generateVisualizationContent(viz?.id ?? '', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      const updatedViz = await fakeVisualizationRepo.getById(viz?.id ?? '', 'feed-1', 'user-123');
      expect(updatedViz.ok && updatedViz.value?.status).toBe('error');
      expect(updatedViz.ok && updatedViz.value?.errorMessage).not.toBe(null);
    });
  });

  describe('repository errors', () => {
    it('returns error when visualization fetch fails', async () => {
      fakeVisualizationRepo.setFailNextGet(true);

      const result = await generateVisualizationContent('viz-1', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });

    it('returns error when snapshot fetch fails', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      fakeSnapshotRepo.setFailNextGet(true);

      const result = await generateVisualizationContent(viz?.id ?? '', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });
  });

  describe('logging', () => {
    it('calls logger when provided', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
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

      await generateVisualizationContent(viz?.id ?? '', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
        logger,
      });

      expect(logCalls.length).toBeGreaterThan(0);
      expect(logCalls.some((call) => call.includes('Generating visualization content'))).toBe(true);
    });

    it('works without logger', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
        feedId: 'feed-1',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-10T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const result = await generateVisualizationContent(viz?.id ?? '', 'feed-1', 'user-123', {
        visualizationRepository: fakeVisualizationRepo,
        visualizationGenerationService: fakeVisualizationGenerationService,
        snapshotRepository: fakeSnapshotRepo,
      });

      expect(result.ok).toBe(true);
    });
  });
});
