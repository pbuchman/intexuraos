import { describe, it, expect } from 'vitest';
import { interpretImposePrompt } from '../prompts/interpret-impose-prompt.js';
import { generateDraftPrompt } from '../prompts/generate-draft-prompt.js';
import { emptyState } from '../domain/models/materializedBufferState.js';

describe('interpretImposePrompt', () => {
  it('has correct metadata', () => {
    expect(interpretImposePrompt.name).toBe('interpret-impose');
    expect(interpretImposePrompt.version).toBe('2.0.0');
    expect(interpretImposePrompt.description).toBeDefined();
  });

  it('includes utterance in output', () => {
    const result = interpretImposePrompt.build({
      utterance: 'I want to add a new idea',
      currentState: emptyState(),
    });

    expect(result).toContain('I want to add a new idea');
  });

  it('includes current thoughts', () => {
    const state = {
      ...emptyState(),
      thoughts: [
        { id: 't1', text: 'First thought', addedAt: '2024-01-01T00:00:00.000Z' },
      ],
    };

    const result = interpretImposePrompt.build({
      utterance: 'Add another thought',
      currentState: state,
    });

    expect(result).toContain('First thought');
    expect(result).toContain('t1');
  });

  it('shows (none) for empty state', () => {
    const result = interpretImposePrompt.build({
      utterance: 'Hello',
      currentState: emptyState(),
    });

    expect(result).toContain('(none)');
  });

  it('does not include writing samples, style, audience, or content goal sections', () => {
    const result = interpretImposePrompt.build({
      utterance: 'test',
      currentState: emptyState(),
    });

    expect(result).not.toContain('buffer_writing_samples');
    expect(result).not.toContain('buffer_style_instructions');
    expect(result).not.toContain('buffer_audience');
    expect(result).not.toContain('buffer_content_goal');
    expect(result).not.toContain('add_writing_sample');
    expect(result).not.toContain('set_style_instructions');
    expect(result).not.toContain('set_metadata');
  });

  it('includes category in update_draft intent description', () => {
    const result = interpretImposePrompt.build({
      utterance: 'test',
      currentState: emptyState(),
    });

    expect(result).toContain('"category"');
    expect(result).toContain('"threads"');
    expect(result).toContain('"linkedin"');
    expect(result).toContain('"general"');
  });
});

describe('generateDraftPrompt', () => {
  it('has correct metadata', () => {
    expect(generateDraftPrompt.name).toBe('generate-draft');
    expect(generateDraftPrompt.version).toBe('2.0.0');
    expect(generateDraftPrompt.description).toBeDefined();
  });

  it('includes thoughts', () => {
    const state = {
      ...emptyState(),
      thoughts: [
        { id: 't1', text: 'Idea one', addedAt: '2024-01-01T00:00:00.000Z' },
      ],
    };

    const result = generateDraftPrompt.build({
      state,
      priorDraft: null,
      requestText: 'Write it',
      styleInstructions: null,
      writingSamples: [],
      category: 'general',
    });

    expect(result).toContain('Idea one');
    expect(result).toContain('Write it');
  });

  it('shows no thoughts placeholder for empty state', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: null,
      requestText: 'Generate',
      styleInstructions: null,
      writingSamples: [],
      category: 'general',
    });

    expect(result).toContain('(no thoughts yet)');
  });

  it('includes prior draft when provided', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: '# Old Draft\n\nOld content',
      requestText: 'Improve it',
      styleInstructions: null,
      writingSamples: [],
      category: 'general',
    });

    expect(result).toContain('# Old Draft');
    expect(result).toContain('prior_draft');
  });

  it('does not include prior draft section when null', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: null,
      requestText: 'Write',
      styleInstructions: null,
      writingSamples: [],
      category: 'general',
    });

    expect(result).not.toContain('prior_draft');
  });

  it('includes writing samples from config', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: null,
      requestText: 'Write',
      styleInstructions: null,
      writingSamples: ['My writing style example'],
      category: 'general',
    });

    expect(result).toContain('My writing style example');
    expect(result).toContain('writing_samples');
  });

  it('includes style instructions from config', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: null,
      requestText: 'Write',
      styleInstructions: 'Be formal',
      writingSamples: [],
      category: 'general',
    });

    expect(result).toContain('style_instructions');
    expect(result).toContain('Be formal');
  });

  it('includes target platform', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: null,
      requestText: 'Write',
      styleInstructions: null,
      writingSamples: [],
      category: 'linkedin',
    });

    expect(result).toContain('target_platform');
    expect(result).toContain('LinkedIn');
  });

  it('does not include old user_audience or user_content_goal sections', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: null,
      requestText: 'Write',
      styleInstructions: null,
      writingSamples: [],
      category: 'general',
    });

    expect(result).not.toContain('user_audience');
    expect(result).not.toContain('user_content_goal');
    expect(result).not.toContain('user_writing_samples');
    expect(result).not.toContain('user_style_instructions');
  });

  it('escapes XML tags in user input', () => {
    const state = {
      ...emptyState(),
      thoughts: [
        { id: 't1', text: '<script>alert("xss")</script>', addedAt: '2024-01-01T00:00:00.000Z' },
      ],
    };

    const result = generateDraftPrompt.build({
      state,
      priorDraft: null,
      requestText: 'Write',
      styleInstructions: null,
      writingSamples: [],
      category: 'general',
    });

    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });
});
