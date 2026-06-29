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
      reason: 'User accepted prior calendar proposal.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts clarification with a non-empty question', () => {
    const result = IntexAgentIntentClassifierOutputSchema.safeParse({
      outcome: 'needs_clarification',
      confidence: 0.8,
      question: 'Which one should I handle first?',
      reason: 'Multiple possible resource intents.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts conversation, greeting, and unsupported classifications', () => {
    for (const outcome of ['conversation', 'greeting', 'unsupported'] as const) {
      const result = IntexAgentIntentClassifierOutputSchema.safeParse({
        outcome,
        confidence: 0.9,
        reason: 'No tool needed.',
      });

      expect(result.success).toBe(true);
    }
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
      }).success
    ).toBe(false);

    expect(
      IntexAgentIntentClassifierOutputSchema.safeParse({
        outcome: 'tool',
        confidence: 0.9,
        allowedToolNames: ['send_email'],
      }).success
    ).toBe(false);
  });
});
