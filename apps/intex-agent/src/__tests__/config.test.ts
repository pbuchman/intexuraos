import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { INTEX_AGENT_MODEL } from '../domain/agent/systemPrompt.js';

describe('loadConfig', () => {
  beforeEach(clearConfigEnv);
  afterEach(clearConfigEnv);

  it('loads explicit environment values', () => {
    process.env['PORT'] = '8134';
    process.env['HOST'] = '127.0.0.1';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'project-1';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    process.env['INTEXURAOS_NOTES_AGENT_URL'] = 'http://notes-agent.test';
    process.env['INTEXURAOS_CALENDAR_AGENT_URL'] = 'http://calendar-agent.test';
    process.env['INTEXURAOS_RESEARCH_AGENT_URL'] = 'http://research-agent.test';
    process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'] = 'http://bookmarks-agent.test';
    process.env['INTEXURAOS_CODE_AGENT_URL'] = 'http://code-agent.test';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://llm-usage.test';
    process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'openrouter-key';
    process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'] = 'whatsapp-send';
    process.env['INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS'] = '120000';

    expect(loadConfig()).toEqual({
      port: 8134,
      host: '127.0.0.1',
      gcpProjectId: 'project-1',
      internalAuthToken: 'secret',
      notesAgentUrl: 'http://notes-agent.test',
      calendarAgentUrl: 'http://calendar-agent.test',
      researchAgentUrl: 'http://research-agent.test',
      bookmarksAgentUrl: 'http://bookmarks-agent.test',
      codeAgentUrl: 'http://code-agent.test',
      llmUsageServiceUrl: 'http://llm-usage.test',
      openRouterAppApiKey: 'openrouter-key',
      whatsappSendTopic: 'whatsapp-send',
      sessionTimeoutMs: 120000,
      model: INTEX_AGENT_MODEL,
    });
  });

  it('uses development defaults for optional process settings', () => {
    expect(loadConfig()).toEqual({
      port: 8080,
      host: '0.0.0.0',
      gcpProjectId: '',
      internalAuthToken: '',
      notesAgentUrl: '',
      calendarAgentUrl: '',
      researchAgentUrl: '',
      bookmarksAgentUrl: '',
      codeAgentUrl: '',
      llmUsageServiceUrl: '',
      openRouterAppApiKey: '',
      whatsappSendTopic: '',
      sessionTimeoutMs: 30 * 60 * 1000,
      model: INTEX_AGENT_MODEL,
    });
  });
});

function clearConfigEnv(): void {
  delete process.env['PORT'];
  delete process.env['HOST'];
  delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
  delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  delete process.env['INTEXURAOS_NOTES_AGENT_URL'];
  delete process.env['INTEXURAOS_CALENDAR_AGENT_URL'];
  delete process.env['INTEXURAOS_RESEARCH_AGENT_URL'];
  delete process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'];
  delete process.env['INTEXURAOS_CODE_AGENT_URL'];
  delete process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
  delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
  delete process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'];
  delete process.env['INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS'];
}
