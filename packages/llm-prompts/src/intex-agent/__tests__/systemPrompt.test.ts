import { describe, expect, it } from 'vitest';
import { INTEX_AGENT_SYSTEM_PROMPT, buildIntexAgentSystemPrompt } from '../systemPrompt.js';

const CURRENT_DATE_TIME = '2026-06-24T10:00:00.000Z';

describe('buildIntexAgentSystemPrompt', () => {
  it('exposes prompt metadata with semver versions', () => {
    expect(INTEX_AGENT_SYSTEM_PROMPT.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(buildIntexAgentSystemPrompt.name).toBe('intex-agent-system-prompt');
    expect(buildIntexAgentSystemPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('builds the base prompt with the current date-time', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      userPreferences: null,
    });

    expect(prompt).toBe(
      `${INTEX_AGENT_SYSTEM_PROMPT.text}\n\nCurrent date-time: ${CURRENT_DATE_TIME}`
    );
  });

  it('includes non-empty user preferences behind the durable-guidance guard', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      userPreferences: '  - Prefer concise Polish replies.  ',
    });

    expect(prompt).toContain('User Preferences are durable user guidance');
    expect(prompt).toContain('- Prefer concise Polish replies.');
    expect(prompt).toContain(`Current date-time: ${CURRENT_DATE_TIME}`);
  });

  it('omits blank user preferences', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      userPreferences: '   ',
    });

    expect(prompt).not.toContain('User Preferences are durable user guidance');
    expect(prompt).toContain(`Current date-time: ${CURRENT_DATE_TIME}`);
  });
});
