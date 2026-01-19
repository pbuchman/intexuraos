/**
 * Tests for Research model factory functions.
 */
import { describe, expect, it } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
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
        selectedModels: [LlmModels.Gemini25Flash],
        synthesisModel: LlmModels.Gemini25Flash,
      });

      expect(research.favourite).toBe(false);
    });

    it('creates research with expected fields', () => {
      const research = createResearch({
        id: 'test-id',
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Flash, LlmModels.ClaudeSonnet45],
        synthesisModel: LlmModels.ClaudeSonnet45,
      });

      expect(research.id).toBe('test-id');
      expect(research.userId).toBe('user-123');
      expect(research.prompt).toBe('Test prompt');
      expect(research.status).toBe('pending');
      expect(research.selectedModels).toEqual([LlmModels.Gemini25Flash, LlmModels.ClaudeSonnet45]);
      expect(research.synthesisModel).toBe(LlmModels.ClaudeSonnet45);
      expect(research.llmResults).toHaveLength(2);
    });

    it('stores originalPrompt when provided', () => {
      const research = createResearch({
        id: 'test-id',
        userId: 'user-123',
        prompt: 'Improved prompt with more context',
        originalPrompt: 'Original poor prompt',
        selectedModels: [LlmModels.Gemini25Flash],
        synthesisModel: LlmModels.Gemini25Flash,
      });

      expect(research.prompt).toBe('Improved prompt with more context');
      expect(research.originalPrompt).toBe('Original poor prompt');
    });

    it('does not set originalPrompt when not provided', () => {
      const research = createResearch({
        id: 'test-id',
        userId: 'user-123',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Flash],
        synthesisModel: LlmModels.Gemini25Flash,
      });

      expect(research.originalPrompt).toBeUndefined();
    });
  });

  describe('createDraftResearch', () => {
    it('initializes favourite to false', () => {
      const research = createDraftResearch({
        id: 'draft-id',
        userId: 'user-123',
        title: 'Draft Title',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Flash],
        synthesisModel: LlmModels.Gemini25Flash,
      });

      expect(research.favourite).toBe(false);
    });

    it('creates draft research with status draft', () => {
      const research = createDraftResearch({
        id: 'draft-id',
        userId: 'user-123',
        title: 'Draft Title',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Flash],
        synthesisModel: LlmModels.Gemini25Flash,
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
      selectedModels: [LlmModels.Gemini25Flash],
      synthesisModel: LlmModels.Gemini25Flash,
      status: 'completed',
      llmResults: [
        {
          provider: LlmProviders.Google,
          model: LlmModels.Gemini25Flash,
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
        additionalModels: [LlmModels.ClaudeSonnet45],
      });

      expect(enhanced.favourite).toBe(false);
    });

    it('creates enhanced research with source reference', () => {
      const enhanced = createEnhancedResearch({
        id: 'enhanced-id',
        userId: 'user-123',
        sourceResearch,
        additionalModels: [LlmModels.ClaudeSonnet45],
      });

      expect(enhanced.sourceResearchId).toBe('source-id');
      expect(enhanced.status).toBe('pending');
      expect(enhanced.prompt).toBe('Original prompt');
    });
  });
});
