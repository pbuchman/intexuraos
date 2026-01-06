#!/usr/bin/env npx tsx
/**
 * Test script for verifying all LLM V2 clients work correctly with real API keys.
 *
 * Usage:
 *   npx tsx scripts/test-llm-clients.ts <userId>
 *
 * This script:
 * 1. Fetches API keys from user-service (internal endpoint)
 * 2. Tests each provider's V2 client research(), generate(), and generateImage() methods
 * 3. Displays usage information from each call
 * 4. Saves results as JSON files in test-results/
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { createGeminiClientV2 } from '@intexuraos/infra-gemini';
import { createGptClientV2 } from '@intexuraos/infra-gpt';
import { createClaudeClientV2 } from '@intexuraos/infra-claude';
import { createPerplexityClientV2 } from '@intexuraos/infra-perplexity';
import type { LLMClient, ModelPricing, NormalizedUsage } from '@intexuraos/llm-contract';

const MODELS = {
  google: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  perplexity: 'sonar',
} as const;

// Default pricing for testing - these should match production values
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  google: {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    groundingCostPerRequest: 0.035,
    imagePricing: {
      '1024x1024': 0.02,
      '1536x1024': 0.04,
      '1024x1536': 0.04,
    },
  },
  openai: {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    cacheReadMultiplier: 0.5,
    webSearchCostPerCall: 0.03,
    imagePricing: {
      '1024x1024': 0.04,
      '1536x1024': 0.08,
      '1024x1536': 0.08,
    },
  },
  anthropic: {
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
  },
  perplexity: {
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 1.0,
    useProviderCost: true,
  },
};

const RESEARCH_PROMPT = `Zbadaj, na podstawie tego jak wyglądały trendy w ostatnich 3 latach, jakie języki programowania będą najpopularniejsze w przeciągu najbliższych 3 lat. Odpowiedź krótko, 2-3 zdania.`;

const GENERATE_PROMPT = `Wygeneruj listę 5 najpopularniejszych języków programowania w 2024 roku. Każdy w jednej linii.`;

const IMAGE_PROMPT = `Ultra-detailed photorealistic scene: a cute guinea pig riding a majestic unicorn at full gallop toward a delicate, slender adult blonde woman in the distance; dynamic motion blur on background only, crisp fur and mane micro-detail, cinematic golden-hour lighting, shallow depth of field, 8K, sharp focus, whimsical fairytale realism, no text, no watermark, no NSFW`;

interface ApiKeys {
  google: string | null;
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
}

function maskKey(key: string | null): string {
  if (key === null) return '(not configured)';
  if (key.length < 8) return '***';
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

function formatUsage(usage: NormalizedUsage): string {
  const parts = [
    `Input: ${usage.inputTokens}`,
    `Output: ${usage.outputTokens}`,
    `Total: ${usage.totalTokens}`,
    `Cost: $${usage.costUsd.toFixed(6)}`,
  ];
  if (usage.cacheTokens !== undefined && usage.cacheTokens > 0) {
    parts.push(`Cache: ${usage.cacheTokens}`);
  }
  if (usage.webSearchCalls !== undefined && usage.webSearchCalls > 0) {
    parts.push(`WebSearchCalls: ${usage.webSearchCalls}`);
  }
  if (usage.groundingEnabled === true) {
    parts.push(`Grounding: enabled`);
  }
  return parts.join(' | ');
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

function createClientV2(
  provider: string,
  apiKey: string,
  model: string,
  userId: string,
  pricing: ModelPricing
): LLMClient {
  switch (provider) {
    case 'google':
      return createGeminiClientV2({ apiKey, model, userId, pricing });
    case 'openai':
      return createGptClientV2({ apiKey, model, userId, pricing });
    case 'anthropic':
      return createClaudeClientV2({ apiKey, model, userId, pricing });
    case 'perplexity':
      return createPerplexityClientV2({ apiKey, model, userId, pricing });
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

  console.log('\n=== LLM V2 Clients Test Script ===\n');

  const keys = await fetchUserApiKeys(userId);

  console.log(`\nUser: ${userId}`);
  console.log(`Google key:     ${maskKey(keys.google)}`);
  console.log(`OpenAI key:     ${maskKey(keys.openai)}`);
  console.log(`Anthropic key:  ${maskKey(keys.anthropic)}`);
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

  mkdirSync('test-results', { recursive: true });

  for (const [provider, model] of Object.entries(MODELS)) {
    const apiKey = keys[provider as keyof typeof keys];
    if (apiKey === null) {
      console.log(`\n⚠️  Skipping ${provider} - no API key configured`);
      continue;
    }

    const pricing = DEFAULT_PRICING[provider];
    if (pricing === undefined) {
      console.log(`\n⚠️  Skipping ${provider} - no pricing configured`);
      continue;
    }

    console.log(`\n━━━ Testing ${provider.toUpperCase()} V2 (${model}) ━━━`);

    const client = createClientV2(provider, apiKey, model, userId, pricing);

    // Test research()
    console.log(`\n🔬 Testing ${provider}.research()...`);
    try {
      const researchResult = await client.research(RESEARCH_PROMPT);
      saveResult(`${provider}_research`, researchResult);
      if (researchResult.ok) {
        console.log(`   ✓ Success: ${researchResult.value.content.substring(0, 100)}...`);
        console.log(`   📊 Usage: ${formatUsage(researchResult.value.usage)}`);
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
        console.log(`   📊 Usage: ${formatUsage(generateResult.value.usage)}`);
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
          const imagePath = `test-results/${provider}_image.png`;
          writeFileSync(imagePath, imageData);
          console.log(`   ✓ Success: Generated image saved to ${imagePath}`);
          console.log(`   → Size: ${imageData.length} bytes`);
          console.log(`   📊 Usage: Cost: $${imageResult.value.usage.costUsd.toFixed(6)}`);
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

  console.log('\n\n✅ All tests completed! Results saved to test-results/\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
