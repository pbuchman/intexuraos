import { createHash } from 'node:crypto';
import { IntexAgentModels, type IntexAgentModel } from '@intexuraos/llm-contract';

export const INTEX_AGENT_CATALOG_SNAPSHOT_VERSION = '2026-08-18' as const;

export const INTEX_AGENT_REQUIRED_PARAMETERS = [
  'tools',
  'tool_choice',
  'response_format',
  'structured_outputs',
] as const;

export interface IntexAgentCatalogModelEvidence {
  id: IntexAgentModel;
  rawId: string;
  contextLength: number;
  promptPerToken: number;
  completionPerToken: number;
  cacheReadPerToken?: number;
  inputModalities: readonly string[];
  outputModalities: readonly string[];
  requiredParameters: typeof INTEX_AGENT_REQUIRED_PARAMETERS;
  entryDigest: string;
}

export interface IntexAgentCatalogEvidence {
  snapshotVersion: typeof INTEX_AGENT_CATALOG_SNAPSHOT_VERSION;
  fetchedAt: string;
  models: readonly IntexAgentCatalogModelEvidence[];
}

interface ReviewedModel {
  id: IntexAgentModel;
  rawId: string;
  minimumContextLength: number;
  requiresCacheReadPricing?: boolean;
}

const REVIEWED_MODELS: readonly ReviewedModel[] = [
  {
    id: IntexAgentModels.DeepSeekV4Flash,
    rawId: 'deepseek/deepseek-v4-flash',
    minimumContextLength: 1_000_000,
    requiresCacheReadPricing: true,
  },
  {
    id: IntexAgentModels.MiniMaxM3,
    rawId: 'minimax/minimax-m3',
    minimumContextLength: 205_000,
  },
  {
    id: IntexAgentModels.Gemini36Flash,
    rawId: 'google/gemini-3.6-flash',
    minimumContextLength: 1_048_576,
  },
] as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`OpenRouter catalog ${label} is malformed`);
  }
  return value as Record<string, unknown>;
}

function positiveFinite(value: unknown, label: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`OpenRouter catalog ${label} must be a positive finite value`);
  }
  return parsed;
}

function textModalities(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`OpenRouter catalog ${label} modalities are malformed`);
  }
  if (!value.includes('text')) {
    throw new Error(`OpenRouter catalog ${label} must support text modalities`);
  }
  return value;
}

function digest(entry: IntexAgentCatalogModelEvidence): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: entry.id,
        rawId: entry.rawId,
        contextLength: entry.contextLength,
        promptPerToken: entry.promptPerToken,
        completionPerToken: entry.completionPerToken,
        ...(entry.cacheReadPerToken !== undefined && {
          cacheReadPerToken: entry.cacheReadPerToken,
        }),
        inputModalities: entry.inputModalities,
        outputModalities: entry.outputModalities,
        requiredParameters: entry.requiredParameters,
      })
    )
    .digest('hex');
}

/**
 * Validates the reviewed Intex Agent subset of a bounded OpenRouter catalog.
 * Any absent or malformed requirement is rejected so callers never substitute
 * stale fallback pricing for catalog admission.
 */
export function assertIntexAgentCatalogConformance(
  liveCatalog: unknown,
  fetchedAt: string
): IntexAgentCatalogEvidence {
  const root = asRecord(liveCatalog, 'response');
  if (!Array.isArray(root['data'])) {
    throw new Error('OpenRouter catalog response data is malformed');
  }

  const entriesById = new Map<string, Record<string, unknown>>();
  for (const value of root['data']) {
    const entry = asRecord(value, 'entry');
    if (typeof entry['id'] === 'string') {
      entriesById.set(entry['id'], entry);
    }
  }

  const models = REVIEWED_MODELS.map((reviewed): IntexAgentCatalogModelEvidence => {
    const entry = entriesById.get(reviewed.rawId);
    if (entry === undefined) {
      throw new Error(`OpenRouter catalog is missing required model ${reviewed.rawId}`);
    }

    const contextLength = positiveFinite(entry['context_length'], `${reviewed.rawId} context`);
    if (contextLength < reviewed.minimumContextLength) {
      throw new Error(`OpenRouter catalog ${reviewed.rawId} context is below its reviewed minimum`);
    }

    const pricing = asRecord(entry['pricing'], `${reviewed.rawId} pricing`);
    const promptPerToken = positiveFinite(pricing['prompt'], `${reviewed.rawId} prompt pricing`);
    const completionPerToken = positiveFinite(
      pricing['completion'],
      `${reviewed.rawId} completion pricing`
    );
    const architecture = asRecord(entry['architecture'], `${reviewed.rawId} architecture`);
    const inputModalities = textModalities(
      architecture['input_modalities'],
      `${reviewed.rawId} input`
    );
    const outputModalities = textModalities(
      architecture['output_modalities'],
      `${reviewed.rawId} output`
    );
    const supportedParameters = entry['supported_parameters'];
    if (
      !Array.isArray(supportedParameters) ||
      !supportedParameters.every((value) => typeof value === 'string')
    ) {
      throw new Error(`OpenRouter catalog ${reviewed.rawId} supported parameters are malformed`);
    }
    for (const parameter of INTEX_AGENT_REQUIRED_PARAMETERS) {
      if (!supportedParameters.includes(parameter)) {
        throw new Error(`OpenRouter catalog ${reviewed.rawId} is missing ${parameter}`);
      }
    }

    const cacheReadPerToken =
      reviewed.requiresCacheReadPricing !== true
        ? undefined
        : positiveFinite(pricing['input_cache_read'], `${reviewed.rawId} cache-read pricing`);

    const evidence: IntexAgentCatalogModelEvidence = {
      id: reviewed.id,
      rawId: reviewed.rawId,
      contextLength,
      promptPerToken,
      completionPerToken,
      ...(cacheReadPerToken !== undefined && { cacheReadPerToken }),
      inputModalities,
      outputModalities,
      requiredParameters: INTEX_AGENT_REQUIRED_PARAMETERS,
      entryDigest: '',
    };

    return { ...evidence, entryDigest: digest(evidence) };
  });

  return {
    snapshotVersion: INTEX_AGENT_CATALOG_SNAPSHOT_VERSION,
    fetchedAt,
    models,
  };
}
