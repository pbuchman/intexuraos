import { describe, expect, it } from 'vitest';
import { IntexAgentRunnerOutputSchema } from '../runnerOutputSchemas.js';

describe('IntexAgentRunnerOutputSchema', () => {
  it('accepts completed output with a supported tool name', () => {
    const result = IntexAgentRunnerOutputSchema.safeParse({
      outcome: 'completed',
      reply: 'Created the calendar event.',
      summary: 'Scheduled dentist appointment.',
      toolName: 'create_calendar_event',
    });

    expect(result.success).toBe(true);
  });

  it('accepts clarification with targeted question metadata', () => {
    const result = IntexAgentRunnerOutputSchema.safeParse({
      outcome: 'needs_clarification',
      reply: 'What time should I schedule it?',
      clarification: 'What time should I schedule it?',
      blockerReason: 'missing_required_details',
      missingFields: ['start', 'end'],
      suggestedNextStep: 'Ask for the missing start and end time.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts unsupported only with exact blocker metadata', () => {
    const result = IntexAgentRunnerOutputSchema.safeParse({
      outcome: 'unsupported',
      reply: 'I cannot buy concert tickets. I can save the ticket details as a note.',
      blockerReason: 'unsupported_capability',
      suggestedNextStep: 'Offer to save ticket details or create a reminder.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts no-action replies without blocker metadata', () => {
    const result = IntexAgentRunnerOutputSchema.safeParse({
      outcome: 'no_action',
      reply: 'Hi! How can I help?',
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid runner outputs instead of silently normalizing them', () => {
    expect(
      IntexAgentRunnerOutputSchema.safeParse({
        outcome: 'completed',
        reply: 'Done.',
        toolName: 'send_email',
      }).success
    ).toBe(false);

    expect(
      IntexAgentRunnerOutputSchema.safeParse({
        outcome: 'completed',
        toolName: 'create_note',
      }).success
    ).toBe(false);

    expect(
      IntexAgentRunnerOutputSchema.safeParse({
        outcome: 'delegated',
        reply: 'Working on it.',
      }).success
    ).toBe(false);
  });

  it('rejects clarification without a question-like reply or clarification field', () => {
    const result = IntexAgentRunnerOutputSchema.safeParse({
      outcome: 'needs_clarification',
      reply: 'Missing details.',
      blockerReason: 'missing_required_details',
      suggestedNextStep: 'Ask for the date.',
    });

    expect(result.success).toBe(false);
  });

  it('rejects clarification with a blank clarification field and non-question reply', () => {
    const result = IntexAgentRunnerOutputSchema.safeParse({
      outcome: 'needs_clarification',
      reply: 'Missing details.',
      clarification: '   ',
      blockerReason: 'missing_required_details',
      suggestedNextStep: 'Ask for the date.',
    });

    expect(result.success).toBe(false);
  });

  it('rejects unsupported without blocker metadata', () => {
    const result = IntexAgentRunnerOutputSchema.safeParse({
      outcome: 'unsupported',
      reply: 'I cannot do that.',
    });

    expect(result.success).toBe(false);
  });

  it('rejects unsupported for clarification-only blocker reasons', () => {
    const result = IntexAgentRunnerOutputSchema.safeParse({
      outcome: 'unsupported',
      reply: 'I cannot do that.',
      blockerReason: 'missing_required_details',
      suggestedNextStep: 'Ask for the missing details.',
    });

    expect(result.success).toBe(false);
  });
});
