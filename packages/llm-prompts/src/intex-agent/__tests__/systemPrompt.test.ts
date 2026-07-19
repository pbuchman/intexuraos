import { describe, expect, it } from 'vitest';
import { INTEX_AGENT_SYSTEM_PROMPT, buildIntexAgentSystemPrompt } from '../systemPrompt.js';

const CURRENT_DATE_TIME = '2026-06-24T10:00:00.000Z';
const TIME_ZONE = 'UTC';

describe('buildIntexAgentSystemPrompt', () => {
  it('exposes prompt metadata with semver versions', () => {
    expect(INTEX_AGENT_SYSTEM_PROMPT.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(INTEX_AGENT_SYSTEM_PROMPT.version).toBe('20.0.0');
    expect(buildIntexAgentSystemPrompt.name).toBe('intex-agent-system-prompt');
    expect(buildIntexAgentSystemPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(buildIntexAgentSystemPrompt.version).toBe('13.0.0');
  });

  it('builds the base prompt with the current date-time', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      timeZone: TIME_ZONE,
      userPreferences: null,
    });

    expect(prompt).toBe(
      [
        INTEX_AGENT_SYSTEM_PROMPT.text,
        '',
        'IANA time zone: UTC',
        'Current date-time: 2026-06-24T10:00:00.000+00:00',
        'Whole-day local bounds for query_calendar_events:',
        'today: timeMin=2026-06-24T00:00:00.000+00:00; timeMax=2026-06-25T00:00:00.000+00:00',
        'tomorrow: timeMin=2026-06-25T00:00:00.000+00:00; timeMax=2026-06-26T00:00:00.000+00:00',
      ].join('\n')
    );
  });

  it('includes non-empty user preferences behind the durable-guidance guard', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      timeZone: TIME_ZONE,
      userPreferences: '  - Prefer concise Polish replies.  ',
    });

    expect(prompt).toContain('User Preferences are durable user guidance');
    expect(prompt).toContain('style, language, tone, brevity, formality, and irony');
    expect(prompt).toContain('unsupported tool use');
    expect(prompt).toContain('unavailable data access');
    expect(prompt).toContain('conflict with an explicit current-turn instruction');
    expect(prompt).toContain('- Prefer concise Polish replies.');
    expect(prompt).toContain('Current date-time: 2026-06-24T10:00:00.000+00:00');
  });

  it('uses Intex display copy and asks before unsupported refusals', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      timeZone: TIME_ZONE,
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
      timeZone: TIME_ZONE,
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
      timeZone: TIME_ZONE,
      userPreferences: null,
    });

    expect(prompt).toContain('Do as much useful work as possible before naming a blocker');
    expect(prompt).toContain('analyze, extract, classify, count, summarize');
    expect(prompt).toContain('When the user provides a list of possible calendar events');
    expect(prompt).toContain('show every event candidate you can identify');
    expect(prompt).toContain('create only one calendar event per confirmed tool call');
    expect(prompt).toContain('Current-date questions are answerable from Current date-time');
  });

  it('requires explicit semantic Linear association and preserves exact identifiers across clarification', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      timeZone: TIME_ZONE,
      userPreferences: null,
    });

    expect(prompt).toContain(
      'Never infer a missing calendar-event date from Current date-time or treat a bare time such as "at noon" as today'
    );
    expect(prompt).toContain(
      'Preserve every exact user-provided identifier, code, reference, and opaque token verbatim across clarification turns and in final tool arguments'
    );
    expect(prompt).toContain(
      'For a new explicit create or save request after a completed tool action, build the new mutating tool arguments from the current request and its unresolved active clarification chain only'
    );
    expect(prompt).toContain(
      'Never invent an identifier or code that the user did not provide; set linearIssueId only when the user explicitly associates a supplied identifier with a Linear issue or ticket'
    );
    expect(prompt).toContain(
      'An arbitrary opaque identifier, tracking marker, or evaluation marker in the task prompt is not enough; preserve it in the task prompt and omit linearIssueId'
    );
  });

  it('acknowledges current-session context retention without echoing fragment details', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      timeZone: TIME_ZONE,
      userPreferences: null,
    });

    expect(prompt).toContain(
      'When the current user message explicitly asks you only to retain or hold provided context and not save it yet, reply with a short neutral acknowledgement. Do not paraphrase, restate, enumerate, count, or infer the provided fragment details, and do not claim durable storage; the context exists only in the current session.'
    );
  });

  it('localizes a production UTC instant and emits DST-safe Warsaw day bounds', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: '2026-03-28T10:15:30.000Z',
      timeZone: 'Europe/Warsaw',
      userPreferences: null,
    });

    expect(prompt).toContain('IANA time zone: Europe/Warsaw');
    expect(prompt).toContain('Current date-time: 2026-03-28T11:15:30.000+01:00');
    expect(prompt).toContain(
      'today: timeMin=2026-03-28T00:00:00.000+01:00; timeMax=2026-03-29T00:00:00.000+01:00'
    );
    expect(prompt).toContain(
      'tomorrow: timeMin=2026-03-29T00:00:00.000+01:00; timeMax=2026-03-30T00:00:00.000+02:00'
    );
    expect(prompt).toContain('copy the exact timeMin and timeMax from Whole-day local bounds');
  });

  it.each([
    {
      timeZone: 'America/Santiago',
      currentDateTime: '2026-09-05T12:00:00.000Z',
      expectedTomorrowBounds:
        'tomorrow: timeMin=2026-09-06T01:00:00.000-03:00; timeMax=2026-09-07T00:00:00.000-03:00',
    },
    {
      timeZone: 'America/Havana',
      currentDateTime: '2026-03-07T12:00:00.000Z',
      expectedTomorrowBounds:
        'tomorrow: timeMin=2026-03-08T01:00:00.000-04:00; timeMax=2026-03-09T00:00:00.000-04:00',
    },
    {
      timeZone: 'Atlantic/Azores',
      currentDateTime: '2026-03-28T12:00:00.000Z',
      expectedTomorrowBounds:
        'tomorrow: timeMin=2026-03-29T01:00:00.000+00:00; timeMax=2026-03-30T00:00:00.000+00:00',
    },
    {
      timeZone: 'Africa/Cairo',
      currentDateTime: '2026-04-23T12:00:00.000Z',
      expectedTomorrowBounds:
        'tomorrow: timeMin=2026-04-24T01:00:00.000+03:00; timeMax=2026-04-25T00:00:00.000+03:00',
    },
  ])(
    'uses the first valid instant when local midnight is skipped in $timeZone',
    ({ currentDateTime, expectedTomorrowBounds, timeZone }) => {
      const prompt = buildIntexAgentSystemPrompt.build({
        currentDateTime,
        timeZone,
        userPreferences: null,
      });

      expect(prompt).toContain(expectedTomorrowBounds);
    }
  );

  it('emits an empty interval instead of throwing when a civil date is skipped entirely', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: '2011-12-29T12:00:00.000Z',
      timeZone: 'Pacific/Apia',
      userPreferences: null,
    });

    expect(prompt).toContain(
      'today: timeMin=2011-12-29T00:00:00.000-10:00; timeMax=2011-12-31T00:00:00.000+14:00'
    );
    expect(prompt).toContain(
      'tomorrow: timeMin=2011-12-31T00:00:00.000+14:00; timeMax=2011-12-31T00:00:00.000+14:00'
    );
  });

  it('keeps direct answers and explicit tool requests out of generic protocol fallback', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      timeZone: TIME_ZONE,
      userPreferences: null,
    });

    expect(prompt).toContain(
      'If the user asks you to answer, explain, summarize, compare, reason, or reply directly, answer in the reply field with outcome no_action unless a matching read tool is required.'
    );
    expect(prompt).toContain(
      'Use completed only after a tool call actually succeeded in this turn.'
    );
    expect(prompt).toContain(
      'When a tool is exposed because the classifier selected a supported tool intent, call that tool or ask a concrete missing-field clarification; do not return completed without calling the tool.'
    );
    expect(prompt).toContain(
      'For explicit code-task requests with a described task, call create_code_task and let the confirmation preview ask the user to approve it.'
    );
  });

  it('omits blank user preferences', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      timeZone: TIME_ZONE,
      userPreferences: '   ',
    });

    expect(prompt).not.toContain('User Preferences are durable user guidance');
    expect(prompt).toContain('Current date-time: 2026-06-24T10:00:00.000+00:00');
  });
});
