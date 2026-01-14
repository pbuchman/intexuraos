import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import {
  ALL_LLM_MODELS,
  MODEL_PROVIDER_MAP,
  LlmProviders,
  type LLMModel,
} from '@intexuraos/llm-contract';
import { buildServer } from './server.js';
import { getServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
];

validateRequiredEnv(REQUIRED_ENV);

const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
initSentry({
  ...(sentryDsn !== undefined && { dsn: sentryDsn }),
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'app-settings-service',
});

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

/**
 * Validate that all LLM models have pricing defined in Firestore.
 * Fails fast if any model is missing pricing.
 */
async function validateAllModelPricing(): Promise<void> {
  const { pricingRepository } = getServices();

  // Fetch pricing for all providers
  const [google, openai, anthropic, perplexity, zai] = await Promise.all([
    pricingRepository.getByProvider(LlmProviders.Google),
    pricingRepository.getByProvider(LlmProviders.OpenAI),
    pricingRepository.getByProvider(LlmProviders.Anthropic),
    pricingRepository.getByProvider(LlmProviders.Perplexity),
    pricingRepository.getByProvider(LlmProviders.Zai),
  ]);

  // Build a map of all models that have pricing
  const modelsWithPricing = new Set<string>();

  if (google !== null) {
    for (const model of Object.keys(google.models)) {
      modelsWithPricing.add(model);
    }
  }
  if (openai !== null) {
    for (const model of Object.keys(openai.models)) {
      modelsWithPricing.add(model);
    }
  }
  if (anthropic !== null) {
    for (const model of Object.keys(anthropic.models)) {
      modelsWithPricing.add(model);
    }
  }
  if (perplexity !== null) {
    for (const model of Object.keys(perplexity.models)) {
      modelsWithPricing.add(model);
    }
  }
  if (zai !== null) {
    for (const model of Object.keys(zai.models)) {
      modelsWithPricing.add(model);
    }
  }

  // Check each model in ALL_LLM_MODELS
  const missingModels: LLMModel[] = [];
  for (const model of ALL_LLM_MODELS) {
    if (!modelsWithPricing.has(model)) {
      missingModels.push(model);
    }
  }

  if (missingModels.length > 0) {
    const details = missingModels.map((m) => `  - ${m} (${MODEL_PROVIDER_MAP[m]})`).join('\n');
    throw new Error(
      `Missing pricing for ${String(missingModels.length)} LLM model(s):\n${details}\n` +
        'Run migrations to ensure all model pricing is configured.'
    );
  }
}

async function main(): Promise<void> {
  // Validate pricing before starting server
  await validateAllModelPricing();

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
