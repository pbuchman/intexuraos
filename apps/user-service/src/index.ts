import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';

const REQUIRED_ENV = [
  'GOOGLE_CLOUD_PROJECT',
  'AUTH0_DOMAIN',
  'AUTH0_CLIENT_ID',
  'AUTH_JWKS_URL',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
  'INTEXURAOS_ENCRYPTION_KEY',
  'INTERNAL_AUTH_TOKEN',
];

validateRequiredEnv(REQUIRED_ENV);

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
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
