import { describe, it, expect, beforeEach } from 'vitest';
import { createVisualization } from '../createVisualization.js';
import { FakeVisualizationRepository } from '../../../../__tests__/fakes.js';
import type { CreateVisualizationRequest } from '../../types.js';

describe('createVisualization', () => {
  let fakeVisualizationRepo: FakeVisualizationRepository;

  beforeEach(() => {
    fakeVisualizationRepo = new FakeVisualizationRepository();
  });

  describe('success cases', () => {
    it('creates visualization with valid data', async () => {
      const request: CreateVisualizationRequest = {
        title: 'Sales Dashboard',
        description: 'Monthly sales trends and forecasts',
        type: 'chart',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Sales Dashboard');
        expect(result.value.description).toBe('Monthly sales trends and forecasts');
        expect(result.value.type).toBe('chart');
        expect(result.value.status).toBe('pending');
        expect(result.value.feedId).toBe('feed-1');
        expect(result.value.userId).toBe('user-123');
        expect(result.value.htmlContent).toBe(null);
        expect(result.value.errorMessage).toBe(null);
        expect(result.value.renderErrorCount).toBe(0);
      }
    });

    it('trims whitespace from title and description', async () => {
      const request: CreateVisualizationRequest = {
        title: '  Sales Dashboard  ',
        description: '  Monthly sales trends  ',
        type: 'table',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Sales Dashboard');
        expect(result.value.description).toBe('Monthly sales trends');
      }
    });

    it('creates visualization with different types', async () => {
      const types: ('chart' | 'table' | 'summary' | 'custom')[] = [
        'chart',
        'table',
        'summary',
        'custom',
      ];

      for (const type of types) {
        const request: CreateVisualizationRequest = {
          title: `Test ${type}`,
          description: `Test ${type} visualization`,
          type,
        };

        const result = await createVisualization('feed-1', 'user-123', request, {
          visualizationRepository: fakeVisualizationRepo,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.type).toBe(type);
        }
      }
    });
  });

  describe('validation errors', () => {
    it('returns error when title is empty', async () => {
      const request: CreateVisualizationRequest = {
        title: '   ',
        description: 'Valid description',
        type: 'chart',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('Title cannot be empty');
      }
    });

    it('returns error when description is empty', async () => {
      const request: CreateVisualizationRequest = {
        title: 'Valid Title',
        description: '   ',
        type: 'chart',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('Description cannot be empty');
      }
    });

    it('returns error when title exceeds max length', async () => {
      const longTitle = 'a'.repeat(201);
      const request: CreateVisualizationRequest = {
        title: longTitle,
        description: 'Valid description',
        type: 'chart',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('cannot exceed 200 characters');
      }
    });

    it('returns error when description exceeds max length', async () => {
      const longDescription = 'a'.repeat(1001);
      const request: CreateVisualizationRequest = {
        title: 'Valid Title',
        description: longDescription,
        type: 'chart',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('cannot exceed 1000 characters');
      }
    });

    it('accepts title at max length', async () => {
      const maxTitle = 'a'.repeat(200);
      const request: CreateVisualizationRequest = {
        title: maxTitle,
        description: 'Valid description',
        type: 'chart',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(true);
    });

    it('accepts description at max length', async () => {
      const maxDescription = 'a'.repeat(1000);
      const request: CreateVisualizationRequest = {
        title: 'Valid Title',
        description: maxDescription,
        type: 'chart',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('repository errors', () => {
    it('returns error when repository create fails', async () => {
      fakeVisualizationRepo.setFailNextCreate(true);

      const request: CreateVisualizationRequest = {
        title: 'Test Title',
        description: 'Test description',
        type: 'chart',
      };

      const result = await createVisualization('feed-1', 'user-123', request, {
        visualizationRepository: fakeVisualizationRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });
  });
});
