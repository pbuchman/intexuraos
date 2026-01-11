import { describe, it, expect, beforeEach } from 'vitest';
import { reportRenderError } from '../reportRenderError.js';
import { FakeVisualizationRepository } from '../../../../__tests__/fakes.js';

describe('reportRenderError', () => {
  let fakeVisualizationRepo: FakeVisualizationRepository;

  beforeEach(() => {
    fakeVisualizationRepo = new FakeVisualizationRepository();
  });

  describe('success cases', () => {
    it('increments error count on first error', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      const result = await reportRenderError(
        viz?.id ?? '',
        'feed-1',
        'user-123',
        'Script execution failed',
        {
          visualizationRepository: fakeVisualizationRepo,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.errorCount).toBe(1);
        expect(result.value.shouldDisable).toBe(false);
      }
    });

    it('increments error count on multiple errors', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      for (let i = 1; i <= 5; i++) {
        const result = await reportRenderError(
          viz?.id ?? '',
          'feed-1',
          'user-123',
          `Error ${String(i)}`,
          {
            visualizationRepository: fakeVisualizationRepo,
          }
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.errorCount).toBe(i);
          expect(result.value.shouldDisable).toBe(false);
        }
      }
    });

    it('disables visualization after max errors', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      for (let i = 1; i < 10; i++) {
        await reportRenderError(viz?.id ?? '', 'feed-1', 'user-123', `Error ${String(i)}`, {
          visualizationRepository: fakeVisualizationRepo,
        });
      }

      const result = await reportRenderError(
        viz?.id ?? '',
        'feed-1',
        'user-123',
        'Error 10 - should disable',
        {
          visualizationRepository: fakeVisualizationRepo,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.errorCount).toBe(10);
        expect(result.value.shouldDisable).toBe(true);
      }

      const updatedViz = await fakeVisualizationRepo.getById(viz?.id ?? '', 'feed-1', 'user-123');
      expect(updatedViz.ok && updatedViz.value?.status).toBe('error');
      expect(updatedViz.ok && updatedViz.value?.errorMessage).toContain('Too many render errors');
    });

    it('includes last error message when disabling', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      for (let i = 1; i < 10; i++) {
        await reportRenderError(viz?.id ?? '', 'feed-1', 'user-123', 'Generic error', {
          visualizationRepository: fakeVisualizationRepo,
        });
      }

      await reportRenderError(
        viz?.id ?? '',
        'feed-1',
        'user-123',
        'Critical rendering failure',
        {
          visualizationRepository: fakeVisualizationRepo,
        }
      );

      const updatedViz = await fakeVisualizationRepo.getById(viz?.id ?? '', 'feed-1', 'user-123');
      expect(updatedViz.ok && updatedViz.value?.errorMessage).toContain('Critical rendering failure');
    });
  });

  describe('not found errors', () => {
    it('returns error when visualization not found', async () => {
      const result = await reportRenderError(
        'non-existent',
        'feed-1',
        'user-123',
        'Test error',
        {
          visualizationRepository: fakeVisualizationRepo,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('Visualization not found');
      }
    });

    it('returns error when visualization belongs to different user', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      const result = await reportRenderError(viz?.id ?? '', 'feed-1', 'other-user', 'Test error', {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns error when visualization belongs to different feed', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      const result = await reportRenderError(viz?.id ?? '', 'feed-2', 'user-123', 'Test error', {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('repository errors', () => {
    it('returns error when getById fails', async () => {
      fakeVisualizationRepo.setFailNextGet(true);

      const result = await reportRenderError('viz-1', 'feed-1', 'user-123', 'Test error', {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });

    it('returns error when incrementRenderErrorCount fails', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      fakeVisualizationRepo.setFailNextIncrement(true);

      const result = await reportRenderError(viz?.id ?? '', 'feed-1', 'user-123', 'Test error', {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });

    it('returns error when update fails during disable', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      for (let i = 1; i < 10; i++) {
        await reportRenderError(viz?.id ?? '', 'feed-1', 'user-123', 'Error', {
          visualizationRepository: fakeVisualizationRepo,
        });
      }

      fakeVisualizationRepo.setFailNextUpdate(true);

      const result = await reportRenderError(viz?.id ?? '', 'feed-1', 'user-123', 'Error 10', {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });
  });

  describe('edge cases', () => {
    it('does not disable at 9 errors', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      for (let i = 1; i <= 9; i++) {
        const result = await reportRenderError(
          viz?.id ?? '',
          'feed-1',
          'user-123',
          `Error ${String(i)}`,
          {
            visualizationRepository: fakeVisualizationRepo,
          }
        );

        expect(result.ok).toBe(true);
        if (result.ok && i === 9) {
          expect(result.value.errorCount).toBe(9);
          expect(result.value.shouldDisable).toBe(false);
        }
      }

      const updatedViz = await fakeVisualizationRepo.getById(viz?.id ?? '', 'feed-1', 'user-123');
      expect(updatedViz.ok && updatedViz.value?.status).toBe('pending');
    });

    it('disables exactly at 10 errors', async () => {
      const vizResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = vizResult.ok ? vizResult.value : null;

      for (let i = 1; i <= 10; i++) {
        const result = await reportRenderError(
          viz?.id ?? '',
          'feed-1',
          'user-123',
          `Error ${String(i)}`,
          {
            visualizationRepository: fakeVisualizationRepo,
          }
        );

        expect(result.ok).toBe(true);
        if (result.ok && i === 10) {
          expect(result.value.errorCount).toBe(10);
          expect(result.value.shouldDisable).toBe(true);
        }
      }
    });
  });
});
