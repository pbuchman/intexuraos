import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';
import { initializeServices } from './services.js';

const REQUIRED_ENV = [
  'GOOGLE_CLOUD_PROJECT',
  'AUTH_JWKS_URL',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'USER_SERVICE_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
];

validateRequiredEnv(REQUIRED_ENV);

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  // Initialize dependency injection container
  initializeServices();

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

  await app.listen({ port: PORT, host: HOST });
}

main().catch(() => {
  process.exit(1);
});

