import { getErrorMessage } from '@intexuraos/common-core';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';
import { FirestoreDataSourceRepository } from './infra/firestore/dataSourceRepository.js';
import { createUserServiceClient } from './infra/user/userServiceClient.js';
import { createTitleGenerationService } from './infra/gemini/titleGenerationService.js';

const REQUIRED_ENV = ['GOOGLE_CLOUD_PROJECT', 'AUTH_JWKS_URL', 'AUTH_ISSUER', 'AUTH_AUDIENCE'];

validateRequiredEnv(REQUIRED_ENV);

async function main(): Promise<void> {
  const config = loadConfig();

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });

  initServices({
    dataSourceRepository: new FirestoreDataSourceRepository(),
    titleGenerationService: createTitleGenerationService(userServiceClient),
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

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
