import { describe, expect, it } from 'vitest';
import { INTEX_AGENT_SYSTEM_PROMPT, buildIntexAgentSystemPrompt } from '../systemPrompt.js';

const CURRENT_DATE_TIME = '2026-06-24T10:00:00.000Z';

describe('buildIntexAgentSystemPrompt', () => {
  it('exposes prompt metadata with semver versions', () => {
    expect(INTEX_AGENT_SYSTEM_PROMPT.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(INTEX_AGENT_SYSTEM_PROMPT.version).toBe('13.0.0');
    expect(buildIntexAgentSystemPrompt.name).toBe('intex-agent-system-prompt');
    expect(buildIntexAgentSystemPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(buildIntexAgentSystemPrompt.version).toBe('6.0.0');
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
    expect(prompt).toContain('style, language, tone, brevity, formality, and irony');
    expect(prompt).toContain('unsupported tool use');
    expect(prompt).toContain('unavailable data access');
    expect(prompt).toContain('conflict with an explicit current-turn instruction');
    expect(prompt).toContain('- Prefer concise Polish replies.');
    expect(prompt).toContain(`Current date-time: ${CURRENT_DATE_TIME}`);
  });

  it('uses Intex display copy and asks before unsupported refusals', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      userPreferences: null,
    });

    expect(prompt).toContain('manage Intex Agent prompt preferences');
    expect(prompt).toContain('Ambiguous intent means ask one targeted clarification question');
    expect(prompt).toContain('explain the exact blocker');
    expect(prompt).not.toContain('Intex Agent'.toUpperCase());
  });

  it('instructs assistant replies to bold with single asterisks', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      userPreferences: null,
    });

    expect(prompt).toContain(
      'When bold text is useful in the reply value, wrap it in single asterisks'
    );
    expect(prompt).toContain('`*important*`');
    expect(prompt).toContain('Do not use double-asterisk Markdown bold such as `**important**`');
  });

  it('prioritizes useful analysis before tool execution boundaries', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      userPreferences: null,
    });

    expect(prompt).toContain('Do as much useful work as possible before naming a blocker');
    expect(prompt).toContain('analyze, extract, classify, count, summarize');
    expect(prompt).toContain('When the user provides a list of possible calendar events');
    expect(prompt).toContain('show every event candidate you can identify');
    expect(prompt).toContain('create only one calendar event per confirmed tool call');
    expect(prompt).toContain('Current-date questions are answerable from Current date-time');
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
