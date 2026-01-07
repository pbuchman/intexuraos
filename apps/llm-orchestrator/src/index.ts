import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { fetchAllPricing, createPricingContext, type PricingContext } from '@intexuraos/llm-pricing';
import type { ResearchModel, FastModel } from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { initializeServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
];

validateRequiredEnv(REQUIRED_ENV);

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

/** All models used by llm-orchestrator for research and synthesis */
const REQUIRED_MODELS: (ResearchModel | FastModel)[] = [
  // Research models
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-5-20250929',
  'o4-mini-deep-research',
  'gpt-5.2',
  'sonar',
  'sonar-pro',
  'sonar-deep-research',
  // Fast models for title generation
  'gemini-2.0-flash',
];

async function loadPricing(): Promise<PricingContext> {
  const appSettingsUrl = process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

  const pricingResult = await fetchAllPricing(appSettingsUrl, internalAuthToken);
  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  return createPricingContext(pricingResult.value, REQUIRED_MODELS);
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
