/**
 * Tests for Research model factory functions.
 */
import { describe, expect, it } from 'vitest';
import {
  createResearch,
  createDraftResearch,
  createEnhancedResearch,
  type Research,
} from '../../../../domain/research/models/Research.js';

describe('Research factory functions', () => {
  describe('createResearch', () => {
    it('initializes favourite to false', () => {
      const research = createResearch({
        id: 'test-id',
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedModels: ['gemini-2.5-flash'],
        synthesisModel: 'gemini-2.5-flash',
      });

      expect(research.favourite).toBe(false);
    });

    it('creates research with expected fields', () => {
      const research = createResearch({
        id: 'test-id',
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedModels: ['gemini-2.5-flash', 'claude-sonnet-4-5-20250929'],
        synthesisModel: 'claude-sonnet-4-5-20250929',
      });

      expect(research.id).toBe('test-id');
      expect(research.userId).toBe('user-123');
      expect(research.prompt).toBe('Test prompt');
      expect(research.status).toBe('pending');
      expect(research.selectedModels).toEqual(['gemini-2.5-flash', 'claude-sonnet-4-5-20250929']);
      expect(research.synthesisModel).toBe('claude-sonnet-4-5-20250929');
      expect(research.llmResults).toHaveLength(2);
    });
  });

  describe('createDraftResearch', () => {
    it('initializes favourite to false', () => {
      const research = createDraftResearch({
        id: 'draft-id',
        userId: 'user-123',
        title: 'Draft Title',
        prompt: 'Test prompt',
        selectedModels: ['gemini-2.5-flash'],
        synthesisModel: 'gemini-2.5-flash',
      });

      expect(research.favourite).toBe(false);
    });

    it('creates draft research with status draft', () => {
      const research = createDraftResearch({
        id: 'draft-id',
        userId: 'user-123',
        title: 'Draft Title',
        prompt: 'Test prompt',
        selectedModels: ['gemini-2.5-flash'],
        synthesisModel: 'gemini-2.5-flash',
      });

      expect(research.status).toBe('draft');
      expect(research.title).toBe('Draft Title');
    });
  });

  describe('createEnhancedResearch', () => {
    const sourceResearch: Research = {
      id: 'source-id',
      userId: 'user-123',
      title: 'Source Title',
      prompt: 'Original prompt',
      selectedModels: ['gemini-2.5-flash'],
      synthesisModel: 'gemini-2.5-flash',
      status: 'completed',
      llmResults: [
        {
          provider: 'google',
          model: 'gemini-2.5-flash',
          status: 'completed',
          result: 'Test result',
          costUsd: 0.05,
        },
      ],
      startedAt: '2026-01-15T00:00:00Z',
      completedAt: '2026-01-15T00:01:00Z',
      favourite: true,
    };

    it('initializes favourite to false regardless of source favourite value', () => {
      const enhanced = createEnhancedResearch({
        id: 'enhanced-id',
        userId: 'user-123',
        sourceResearch,
        additionalModels: ['claude-sonnet-4-5-20250929'],
      });

      expect(enhanced.favourite).toBe(false);
    });

    it('creates enhanced research with source reference', () => {
      const enhanced = createEnhancedResearch({
        id: 'enhanced-id',
        userId: 'user-123',
        sourceResearch,
        additionalModels: ['claude-sonnet-4-5-20250929'],
      });

      expect(enhanced.sourceResearchId).toBe('source-id');
      expect(enhanced.status).toBe('pending');
      expect(enhanced.prompt).toBe('Original prompt');
    });
  });
});
