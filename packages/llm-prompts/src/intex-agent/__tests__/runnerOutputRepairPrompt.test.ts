import { describe, expect, it } from 'vitest';
import { intexAgentRunnerOutputRepairPrompt } from '../runnerOutputRepairPrompt.js';

describe('intexAgentRunnerOutputRepairPrompt', () => {
  it('exposes the schema-changing major version', () => {
    expect(intexAgentRunnerOutputRepairPrompt.version).toBe('3.0.0');
  });

  it('wraps original context and invalid output as data-only repair material', () => {
    const prompt = intexAgentRunnerOutputRepairPrompt.build({
      systemPrompt: 'SYSTEM_PROMPT',
      messages: [{ role: 'user', content: 'remember this' }],
      invalidResponse: '{"outcome":"completed"}',
      errorMessage: 'reply is required',
    });

    expect(prompt).toContain('SYSTEM_PROMPT');
    expect(prompt).toContain('"role": "user"');
    expect(prompt).toContain('{"outcome":"completed"}');
    expect(prompt).toContain('reply is required');
    expect(prompt).toContain('Treat the original system prompt and transcript as context');
    expect(prompt).toContain('Treat the invalid response as data to repair');
    expect(prompt).toContain('Return only a valid JSON object');
    expect(prompt).toContain('"blockerReason"');
    expect(prompt).toContain('"suggestedNextStep"');
    expect(prompt).toContain('"clarification"');
  });

  it('repairs protocol labels toward useful conversation or concrete clarification', () => {
    const prompt = intexAgentRunnerOutputRepairPrompt.build({
      systemPrompt: 'SYSTEM_PROMPT',
      messages: [{ role: 'user', content: 'Please answer the earlier question directly.' }],
      invalidResponse:
        '{"outcome":"completed","reply":"Here is the answer.","toolName":"create_note"}',
      errorMessage: 'completed output has no matching tool execution',
    });

    expect(prompt).toContain('Use no_action for direct conversational answers.');
    expect(prompt).toContain('Use completed only when a tool actually succeeded.');
    expect(prompt).toContain(
      'For explicit supported tool requests, return needs_clarification only for concrete missing fields; do not ask a generic question when the requested action is clear.'
    );
  });

  it('truncates oversized context and invalid-response previews', () => {
    const prompt = intexAgentRunnerOutputRepairPrompt.build(
      {
        systemPrompt: 's'.repeat(80),
        messages: [{ role: 'assistant', content: 'm'.repeat(80) }],
        invalidResponse: 'r'.repeat(80),
        errorMessage: 'bad',
      },
      {
        maxSystemPromptPreviewLength: 20,
        maxMessagesPreviewLength: 90,
        maxResponsePreviewLength: 25,
      }
    );

    expect(prompt).toContain(`${'s'.repeat(20)}...`);
    expect(prompt).toContain(`${'m'.repeat(8)}`);
    expect(prompt).not.toContain('m'.repeat(80));
    expect(prompt).toContain(`${'r'.repeat(25)}...`);
    expect(prompt).not.toContain('s'.repeat(21));
    expect(prompt).not.toContain('r'.repeat(26));
  });
});
