import type {
  TokenUsage,
  NormalizedUsage,
  ModelPricing,
  ImageSize,
} from '@intexuraos/llm-contract';

export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number {
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;
  const groundingPrice = pricing.groundingCostPerRequest ?? 0;

  const inputCost = usage.inputTokens * inputPrice;
  const outputCost = usage.outputTokens * outputPrice;

  // Safe Math: Calculate Grounding Scaled
  const groundingCostScaled = (usage.groundingEnabled === true ? groundingPrice : 0) * 1_000_000;

  const totalScaledCost = inputCost + outputCost + groundingCostScaled;

  return Math.round(totalScaledCost) / 1_000_000;
}

export function calculateImageCost(size: ImageSize, pricing: ModelPricing): number {
  if (!pricing.imagePricing) return 0;
  return pricing.imagePricing[size] ?? 0;
}

export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  groundingEnabled: boolean,
  pricing: ModelPricing
): NormalizedUsage {
  const usage: TokenUsage = { inputTokens, outputTokens, groundingEnabled };
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateTextCost(usage, pricing),
    ...(groundingEnabled && { groundingEnabled: true }),
  };
}
