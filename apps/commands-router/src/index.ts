import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';

const REQUIRED_ENV = [
  'GOOGLE_CLOUD_PROJECT',
  'AUTH_JWKS_URL',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'INTEXURAOS_GEMINI_API_KEY',
];

validateRequiredEnv(REQUIRED_ENV);

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

  const port = Number(process.env['PORT']) || 8080;
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch(() => {
  process.exit(1);
});
