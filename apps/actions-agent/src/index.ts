import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_RESEARCH_AGENT_URL',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_COMMANDS_AGENT_URL',
  'INTEXURAOS_TODOS_AGENT_URL',
  'INTEXURAOS_NOTES_AGENT_URL',
  'INTEXURAOS_BOOKMARKS_AGENT_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_PUBSUB_ACTIONS_QUEUE',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_WEB_APP_URL',
];

validateRequiredEnv(REQUIRED_ENV);

async function main(): Promise<void> {
  initServices({
    ResearchAgentUrl: process.env['INTEXURAOS_RESEARCH_AGENT_URL'] as string,
    userServiceUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] as string,
    commandsAgentUrl: process.env['INTEXURAOS_COMMANDS_AGENT_URL'] as string,
    todosAgentUrl: process.env['INTEXURAOS_TODOS_AGENT_URL'] as string,
    notesAgentUrl: process.env['INTEXURAOS_NOTES_AGENT_URL'] as string,
    bookmarksAgentUrl: process.env['INTEXURAOS_BOOKMARKS_AGENT_URL'] as string,
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] as string,
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] as string,
    whatsappSendTopic: process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'] as string,
    webAppUrl: process.env['INTEXURAOS_WEB_APP_URL'] as string,
  });

  const app = await buildServer();

  const close = (): void => {
    app.close().then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      }
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  const port = Number(process.env['PORT']) || 8080;
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch(() => {
  process.exit(1);
});
