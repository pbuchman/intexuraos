import { INTEX_AGENT_MODEL } from './domain/agent/systemPrompt.js';

const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export interface ServiceConfig {
  port: number;
  host: string;
  gcpProjectId: string;
  internalAuthToken: string;
  notesAgentUrl: string;
  calendarAgentUrl: string;
  researchAgentUrl: string;
  bookmarksAgentUrl: string;
  codeAgentUrl: string;
  webAppUrl: string;
  llmUsageServiceUrl: string;
  openRouterAppApiKey: string;
  whatsappSendTopic: string;
  sessionTimeoutMs: number;
  model: typeof INTEX_AGENT_MODEL;
}

export function loadConfig(): ServiceConfig {
  return {
    port: Number(process.env['PORT'] ?? 8080),
    host: process.env['HOST'] ?? '0.0.0.0',
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    notesAgentUrl: process.env['INTEXURAOS_NOTES_AGENT_URL'] ?? '',
    calendarAgentUrl: process.env['INTEXURAOS_CALENDAR_AGENT_URL'] ?? '',
    researchAgentUrl: process.env['INTEXURAOS_RESEARCH_AGENT_URL'] ?? '',
    bookmarksAgentUrl: process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'] ?? '',
    codeAgentUrl: process.env['INTEXURAOS_CODE_AGENT_URL'] ?? '',
    webAppUrl: process.env['INTEXURAOS_WEB_APP_URL'] ?? 'https://intexuraos.cloud',
    llmUsageServiceUrl: process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '',
    openRouterAppApiKey: process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '',
    whatsappSendTopic: process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'] ?? '',
    sessionTimeoutMs: Number(
      process.env['INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS'] ?? DEFAULT_SESSION_TIMEOUT_MS
    ),
    model: INTEX_AGENT_MODEL,
  };
}
