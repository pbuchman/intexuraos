#!/usr/bin/env npx tsx
/**
 * Test script for verifying all LLM clients work correctly with real API keys.
 *
 * Usage:
 *   npx tsx scripts/test-llm-clients.ts <userId>
 *
 * This script:
 * 1. Fetches API keys from user-service (internal endpoint)
 * 2. Tests each provider's research(), generate(), and generateImage() methods
 * 3. Logs usage via console.error
 * 4. Saves results as JSON files in scripts/test-results/
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { createGptClient } from '@intexuraos/infra-gpt';
import { createClaudeClient } from '@intexuraos/infra-claude';
import { createPerplexityClient } from '@intexuraos/infra-perplexity';
import type { LLMClient, UsageLogger } from '@intexuraos/llm-contract';

const MODELS = {
  google: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  perplexity: 'sonar',
} as const;

const RESEARCH_PROMPT = `Zbadaj, na podstawie tego jak wyglądały trendy w ostatnich 3 latach, jakie języki programowania będą najpopularniejsze w przeciągu najbliższych 3 lat. Odpowiedź krótko, 2-3 zdania.`;

const GENERATE_PROMPT = `Wygeneruj listę 5 najpopularniejszych języków programowania w 2024 roku. Każdy w jednej linii.`;

const IMAGE_PROMPT = `Ultra-detailed photorealistic scene: a cute guinea pig riding a majestic unicorn at full gallop toward a delicate, slender adult blonde woman in the distance; dynamic motion blur on background only, crisp fur and mane micro-detail, cinematic golden-hour lighting, shallow depth of field, 8K, sharp focus, whimsical fairytale realism, no text, no watermark, no NSFW`;

interface ApiKeys {
  google: string | null;
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
}

const consoleUsageLogger: UsageLogger = {
  async log(params) {
    console.error('\n[USAGE LOG]', JSON.stringify(params, null, 2));
  },
};

function maskKey(key: string | null): string {
  if (key === null) return '(not configured)';
  if (key.length < 8) return '***';
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

async function fetchUserApiKeys(userId: string): Promise<ApiKeys> {
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'];
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

  if (userServiceUrl === undefined || internalAuthToken === undefined) {
    console.error(
      'Error: INTEXURAOS_USER_SERVICE_URL and INTEXURAOS_INTERNAL_AUTH_TOKEN must be set'
    );
    process.exit(1);
  }

  const url = `${userServiceUrl}/internal/users/${encodeURIComponent(userId)}/llm-keys`;
  console.log(`Fetching API keys from: ${url}`);

  const response = await fetch(url, {
    headers: {
      'X-Internal-Auth': internalAuthToken,
    },
  });

  if (!response.ok) {
    console.error(`Failed to fetch API keys: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  return (await response.json()) as ApiKeys;
}

function createClient(
  provider: string,
  apiKey: string,
  model: string,
  userId: string,
  usageLogger: UsageLogger
): LLMClient {
  switch (provider) {
    case 'google':
      return createGeminiClient({ apiKey, model, usageLogger, userId });
    case 'openai':
      return createGptClient({ apiKey, model, usageLogger, userId });
    case 'anthropic':
      return createClaudeClient({ apiKey, model, usageLogger, userId });
    case 'perplexity':
      return createPerplexityClient({ apiKey, model, usageLogger, userId });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function saveResult(name: string, result: unknown): void {
  const path = `test-results/${name}.json`;
  const serializable = JSON.parse(
    JSON.stringify(result, (_key, value) => {
      if (value instanceof Buffer) {
        return `<Buffer ${value.length} bytes>`;
      }
      return value;
    })
  );
  writeFileSync(path, JSON.stringify(serializable, null, 2));
  console.log(`   → Saved: ${path}`);
}

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (userId === undefined) {
    console.error('Usage: npx tsx scripts/test-llm-clients.ts <userId>');
    process.exit(1);
  }

  console.log('\n=== LLM Clients Test Script ===\n');

  const keys = await fetchUserApiKeys(userId);

  console.log(`\nUser: ${userId}`);
  console.log(`Google key:    ${maskKey(keys.google)}`);
  console.log(`OpenAI key:    ${maskKey(keys.openai)}`);
  console.log(`Anthropic key: ${maskKey(keys.anthropic)}`);
  console.log(`Perplexity key: ${maskKey(keys.perplexity)}`);

  const hasAnyKey =
    keys.google !== null ||
    keys.openai !== null ||
    keys.anthropic !== null ||
    keys.perplexity !== null;
  if (!hasAnyKey) {
    console.error('\n❌ Error: No API keys configured for this user. Nothing to test.');
    process.exit(1);
  }

  mkdirSync('scripts/test-results', { recursive: true });

  for (const [provider, model] of Object.entries(MODELS)) {
    const apiKey = keys[provider as keyof typeof keys];
    if (apiKey === null) {
      console.log(`\n⚠️  Skipping ${provider} - no API key configured`);
      continue;
    }

    console.log(`\n━━━ Testing ${provider.toUpperCase()} (${model}) ━━━`);

    const client = createClient(provider, apiKey, model, userId, consoleUsageLogger);

    // Test research()
    console.log(`\n🔬 Testing ${provider}.research()...`);
    try {
      const researchResult = await client.research(RESEARCH_PROMPT);
      saveResult(`${provider}_research`, researchResult);
      if (researchResult.ok) {
        console.log(`   ✓ Success: ${researchResult.value.content.substring(0, 100)}...`);
      } else {
        console.log(`   ✗ Error: ${researchResult.error.message}`);
      }
    } catch (error) {
      console.log(`   ✗ Exception: ${error instanceof Error ? error.message : String(error)}`);
      saveResult(`${provider}_research`, { error: String(error) });
    }

    // Test generate()
    console.log(`\n📝 Testing ${provider}.generate()...`);
    try {
      const generateResult = await client.generate(GENERATE_PROMPT);
      saveResult(`${provider}_generate`, generateResult);
      if (generateResult.ok) {
        console.log(`   ✓ Success: ${generateResult.value.content.substring(0, 100)}...`);
      } else {
        console.log(`   ✗ Error: ${generateResult.error.message}`);
      }
    } catch (error) {
      console.log(`   ✗ Exception: ${error instanceof Error ? error.message : String(error)}`);
      saveResult(`${provider}_generate`, { error: String(error) });
    }

    // Test generateImage() - only for Google and OpenAI
    if (client.generateImage !== undefined && (provider === 'google' || provider === 'openai')) {
      console.log(`\n🖼️  Testing ${provider}.generateImage()...`);
      try {
        const imageResult = await client.generateImage(IMAGE_PROMPT);
        if (imageResult.ok) {
          const imageData = imageResult.value.imageData;
          const imagePath = `scripts/test-results/${provider}_image.png`;
          writeFileSync(imagePath, imageData);
          console.log(`   ✓ Success: Generated image saved to ${imagePath}`);
          console.log(`   → Size: ${imageData.length} bytes`);
          saveResult(`${provider}_image_metadata`, {
            ok: true,
            model: imageResult.value.model,
            usage: imageResult.value.usage,
            imageSizeBytes: imageData.length,
          });
        } else {
          console.log(`   ✗ Error: ${imageResult.error.message}`);
          saveResult(`${provider}_image_metadata`, imageResult);
        }
      } catch (error) {
        console.log(`   ✗ Exception: ${error instanceof Error ? error.message : String(error)}`);
        saveResult(`${provider}_image_metadata`, { error: String(error) });
      }
    }
  }

  console.log('\n\n✅ All tests completed! Results saved to scripts/test-results/\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
