import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'GOOGLE_CLOUD_PROJECT',
  'AUTH_JWKS_URL',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'COMMANDS_ROUTER_URL',
  'LLM_ORCHESTRATOR_URL',
  'USER_SERVICE_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
];

validateRequiredEnv(REQUIRED_ENV);

async function main(): Promise<void> {
  initServices({
    commandsRouterUrl: process.env['COMMANDS_ROUTER_URL'] as string,
    llmOrchestratorUrl: process.env['LLM_ORCHESTRATOR_URL'] as string,
    userServiceUrl: process.env['USER_SERVICE_URL'] as string,
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] as string,
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
