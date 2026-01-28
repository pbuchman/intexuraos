import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import {
  fetchAllPricing,
  createPricingContext,
  type IPricingContext,
} from '@intexuraos/llm-pricing';
import { type ResearchModel, type FastModel, LlmModels } from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { initializeServices } from './services.js';
import { initSentry } from '@intexuraos/infra-sentry';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
  'INTEXURAOS_NOTION_SERVICE_URL',
  'INTEXURAOS_IMAGE_PUBLIC_BASE_URL',
];

validateRequiredEnv(REQUIRED_ENV);

const sentryConfig: Parameters<typeof initSentry>[0] = {
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'research-agent',
};
const dsn = process.env['INTEXURAOS_SENTRY_DSN'];
if (dsn !== undefined) {
  sentryConfig.dsn = dsn;
}
initSentry(sentryConfig);

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

/** All models used by research-agent for research and synthesis */
const REQUIRED_MODELS: (ResearchModel | FastModel)[] = [
  // Research models
  LlmModels.Gemini25Pro,
  LlmModels.Gemini25Flash,
  LlmModels.ClaudeOpus45,
  LlmModels.ClaudeSonnet45,
  LlmModels.O4MiniDeepResearch,
  LlmModels.GPT52,
  LlmModels.Sonar,
  LlmModels.SonarPro,
  LlmModels.SonarDeepResearch,
  // Fast models for title generation
  LlmModels.Gemini20Flash,
];

async function loadPricing(): Promise<IPricingContext> {
  const appSettingsUrl = process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

  process.stdout.write(`Fetching pricing from ${appSettingsUrl}\n`);
  const pricingResult = await fetchAllPricing(appSettingsUrl, internalAuthToken);
  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  const context = createPricingContext(pricingResult.value, REQUIRED_MODELS);
  process.stdout.write(`Loaded pricing for ${String(REQUIRED_MODELS.length)} models: ${REQUIRED_MODELS.join(', ')}\n`);
  return context;
}

async function main(): Promise<void> {
  // Load pricing from app-settings-service
  const pricingContext = await loadPricing();

  // Initialize dependency injection container
  initializeServices(pricingContext);

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

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
