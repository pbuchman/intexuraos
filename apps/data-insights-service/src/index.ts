import { getErrorMessage } from '@intexuraos/common-core';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';
import { FirestoreDataSourceRepository } from './infra/firestore/dataSourceRepository.js';
import { FirestoreCompositeFeedRepository } from './infra/firestore/compositeFeedRepository.js';
import { createUserServiceClient } from './infra/user/userServiceClient.js';
import { createTitleGenerationService } from './infra/gemini/titleGenerationService.js';
import { createFeedNameGenerationService } from './infra/gemini/feedNameGenerationService.js';
import { createMobileNotificationsClient } from './infra/http/mobileNotificationsClient.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
];

validateRequiredEnv(REQUIRED_ENV);

/** Models used by this service */
const REQUIRED_MODELS: FastModel[] = [LlmModels.Gemini25Flash];

async function main(): Promise<void> {
  const config = loadConfig();

  // Fetch pricing from app-settings-service
  const pricingResult = await fetchAllPricing(
    config.appSettingsServiceUrl,
    config.internalAuthToken
  );
  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }
  const pricingContext = createPricingContext(pricingResult.value, [...REQUIRED_MODELS]);

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });

  initServices({
    dataSourceRepository: new FirestoreDataSourceRepository(),
    titleGenerationService: createTitleGenerationService(userServiceClient, pricingContext),
    compositeFeedRepository: new FirestoreCompositeFeedRepository(),
    feedNameGenerationService: createFeedNameGenerationService(userServiceClient, pricingContext),
    mobileNotificationsClient: createMobileNotificationsClient({
      baseUrl: config.mobileNotificationsServiceUrl,
      internalAuthToken: config.internalAuthToken,
    }),
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
