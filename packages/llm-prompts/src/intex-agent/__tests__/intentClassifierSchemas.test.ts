import { describe, expect, it } from 'vitest';
import {
  IntexAgentIntentClassifierOutputSchema,
  IntexAgentIntentClassifierToolNameSchema,
} from '../intentClassifierSchemas.js';

describe('IntexAgentIntentClassifierToolNameSchema', () => {
  it('accepts supported Intex Agent tool names', () => {
    expect(IntexAgentIntentClassifierToolNameSchema.safeParse('create_note').success).toBe(true);
    expect(
      IntexAgentIntentClassifierToolNameSchema.safeParse('query_calendar_events').success
    ).toBe(true);
    expect(
      IntexAgentIntentClassifierToolNameSchema.safeParse('delete_user_preference').success
    ).toBe(true);
  });

  it('rejects unsupported tool names', () => {
    expect(IntexAgentIntentClassifierToolNameSchema.safeParse('send_email').success).toBe(false);
  });
});

describe('IntexAgentIntentClassifierOutputSchema', () => {
  it('accepts a tool classification with confidence and allowed tools', () => {
    const result = IntexAgentIntentClassifierOutputSchema.safeParse({
      outcome: 'tool',
      confidence: 0.92,
      allowedToolNames: ['create_calendar_event'],
      stylePreferenceAction: 'none',
      reason: 'User accepted prior calendar proposal.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts clarification with a non-empty question', () => {
    const result = IntexAgentIntentClassifierOutputSchema.safeParse({
      outcome: 'needs_clarification',
      confidence: 0.8,
      question: 'Which one should I handle first?',
      blockerReason: 'multiple_possible_intents',
      candidateIntents: ['create_note', 'query_calendar_events'],
      missingFields: [],
      suggestedNextStep: 'Ask which supported action to perform first.',
      stylePreferenceAction: 'none',
      reason: 'Multiple possible resource intents.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts conversation, greeting, and retain-context classifications without tools', () => {
    for (const outcome of ['conversation', 'greeting', 'retain_context'] as const) {
      const result = IntexAgentIntentClassifierOutputSchema.safeParse({
        outcome,
        confidence: 0.9,
        stylePreferenceAction: 'none',
        reason: 'No tool needed.',
      });

      expect(result.success).toBe(true);
    }
  });

  it('accepts unsupported only with explicit blocker metadata and next step', () => {
    const result = IntexAgentIntentClassifierOutputSchema.safeParse({
      outcome: 'unsupported',
      confidence: 0.95,
      blockerReason: 'unsupported_capability',
      suggestedNextStep: 'I can save the ticket details as a note instead.',
      stylePreferenceAction: 'none',
      reason: 'Buying tickets is not supported.',
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown outcomes, invalid confidence, and malformed tool lists', () => {
    expect(
      IntexAgentIntentClassifierOutputSchema.safeParse({
        outcome: 'delegated',
        confidence: 0.9,
      }).success
    ).toBe(false);

    expect(
      IntexAgentIntentClassifierOutputSchema.safeParse({
        outcome: 'conversation',
        confidence: 1.2,
        stylePreferenceAction: 'none',
      }).success
    ).toBe(false);

    expect(
      IntexAgentIntentClassifierOutputSchema.safeParse({
        outcome: 'tool',
        confidence: 0.9,
        stylePreferenceAction: 'none',
        allowedToolNames: ['send_email'],
      }).success
    ).toBe(false);
  });

  it('rejects clarification without a question or clarification text', () => {
    const result = IntexAgentIntentClassifierOutputSchema.safeParse({
      outcome: 'needs_clarification',
      confidence: 0.7,
      blockerReason: 'missing_required_details',
      stylePreferenceAction: 'none',
      reason: 'Missing calendar time.',
    });

    expect(result.success).toBe(false);
  });

  it('rejects tool classifications with empty allowed tool lists', () => {
    const result = IntexAgentIntentClassifierOutputSchema.safeParse({
      outcome: 'tool',
      confidence: 0.9,
      allowedToolNames: [],
      stylePreferenceAction: 'none',
    });

    expect(result.success).toBe(false);
  });

  it('rejects non-tool classifications that expose tools', () => {
    const result = IntexAgentIntentClassifierOutputSchema.safeParse({
      outcome: 'conversation',
      confidence: 0.9,
      allowedToolNames: ['create_note'],
      stylePreferenceAction: 'none',
    });

    expect(result.success).toBe(false);
  });

  it('rejects unsupported outcomes for clarification-only blocker reasons', () => {
    for (const blockerReason of [
      'missing_required_details',
      'not_enough_context',
      'multiple_possible_intents',
      'ambiguous_preference_target',
    ] as const) {
      const result = IntexAgentIntentClassifierOutputSchema.safeParse({
        outcome: 'unsupported',
        confidence: 0.9,
        blockerReason,
        suggestedNextStep: 'Ask a question.',
        stylePreferenceAction: 'none',
      });

      expect(result.success).toBe(false);
    }
  });

  it('rejects mutating preference actions without matching preference tools', () => {
    const result = IntexAgentIntentClassifierOutputSchema.safeParse({
      outcome: 'tool',
      confidence: 0.9,
      allowedToolNames: ['create_note'],
      stylePreferenceAction: 'save_new',
    });

    expect(result.success).toBe(false);
  });

  it.each(['apply_this_turn_only', 'needs_clarification'] as const)(
    'rejects %s style preference actions on tool outcomes',
    (stylePreferenceAction) => {
      const result = IntexAgentIntentClassifierOutputSchema.safeParse({
        outcome: 'tool',
        confidence: 0.9,
        allowedToolNames: ['create_note'],
        stylePreferenceAction,
      });

      expect(result.success).toBe(false);
    }
  );
});
