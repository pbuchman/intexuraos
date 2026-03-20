import { describe, it, expect } from 'vitest';
import { interpretImposePrompt } from '../prompts/interpret-impose-prompt.js';
import { generateDraftPrompt } from '../prompts/generate-draft-prompt.js';
import { emptyState } from '../domain/models/materializedBufferState.js';

describe('interpretImposePrompt', () => {
  it('has correct metadata', () => {
    expect(interpretImposePrompt.name).toBe('interpret-impose');
    expect(interpretImposePrompt.version).toBe('1.0.0');
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

  it('includes writing samples when present', () => {
    const state = {
      ...emptyState(),
      writingSamples: ['Sample text here'],
    };

    const result = interpretImposePrompt.build({
      utterance: 'test',
      currentState: state,
    });

    expect(result).toContain('Sample text here');
  });

  it('includes style instructions when present', () => {
    const state = {
      ...emptyState(),
      styleInstructions: 'Write casually',
    };

    const result = interpretImposePrompt.build({
      utterance: 'test',
      currentState: state,
    });

    expect(result).toContain('Write casually');
  });

  it('includes audience and content goal when present', () => {
    const state = {
      ...emptyState(),
      audience: 'Developers',
      contentGoal: 'Tutorial',
    };

    const result = interpretImposePrompt.build({
      utterance: 'test',
      currentState: state,
    });

    expect(result).toContain('Developers');
    expect(result).toContain('Tutorial');
  });
});

describe('generateDraftPrompt', () => {
  it('has correct metadata', () => {
    expect(generateDraftPrompt.name).toBe('generate-draft');
    expect(generateDraftPrompt.version).toBe('1.0.0');
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
    });

    expect(result).toContain('Idea one');
    expect(result).toContain('Write it');
  });

  it('shows no thoughts placeholder for empty state', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: null,
      requestText: 'Generate',
    });

    expect(result).toContain('(no thoughts yet)');
  });

  it('includes prior draft when provided', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: '# Old Draft\n\nOld content',
      requestText: 'Improve it',
    });

    expect(result).toContain('# Old Draft');
    expect(result).toContain('PRIOR DRAFT');
  });

  it('does not include prior draft section when null', () => {
    const result = generateDraftPrompt.build({
      state: emptyState(),
      priorDraft: null,
      requestText: 'Write',
    });

    expect(result).not.toContain('PRIOR DRAFT');
  });

  it('includes writing samples', () => {
    const state = {
      ...emptyState(),
      writingSamples: ['My writing style example'],
    };

    const result = generateDraftPrompt.build({
      state,
      priorDraft: null,
      requestText: 'Write',
    });

    expect(result).toContain('My writing style example');
    expect(result).toContain('WRITING SAMPLES');
  });

  it('includes style instructions', () => {
    const state = {
      ...emptyState(),
      styleInstructions: 'Be formal',
    };

    const result = generateDraftPrompt.build({
      state,
      priorDraft: null,
      requestText: 'Write',
    });

    expect(result).toContain('STYLE INSTRUCTIONS');
    expect(result).toContain('Be formal');
  });

  it('includes audience', () => {
    const state = {
      ...emptyState(),
      audience: 'Executives',
    };

    const result = generateDraftPrompt.build({
      state,
      priorDraft: null,
      requestText: 'Write',
    });

    expect(result).toContain('TARGET AUDIENCE');
    expect(result).toContain('Executives');
  });

  it('includes content goal', () => {
    const state = {
      ...emptyState(),
      contentGoal: 'Whitepaper',
    };

    const result = generateDraftPrompt.build({
      state,
      priorDraft: null,
      requestText: 'Write',
    });

    expect(result).toContain('CONTENT GOAL');
    expect(result).toContain('Whitepaper');
  });
});
