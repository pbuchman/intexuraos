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

  it('accepts non-tool terminal outputs with replies', () => {
    for (const outcome of ['needs_clarification', 'no_action', 'unsupported'] as const) {
      const result = IntexAgentRunnerOutputSchema.safeParse({
        outcome,
        reply: 'Which day?',
      });

      expect(result.success).toBe(true);
    }
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
});
