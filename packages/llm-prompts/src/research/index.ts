/**
 * Research domain module.
 *
 * Contains prompts and utilities for research and synthesis operations.
 */

export { researchPrompt, type ResearchPromptInput } from './researchPrompt.js';
export {
  synthesisPrompt,
  type SynthesisPromptInput,
  type SynthesisReport,
  type AdditionalSource,
  /** @deprecated Use AdditionalSource instead */
  type ExternalReport,
} from './synthesisPrompt.js';
export {
  type SourceId,
  type SourceMapItem,
  type AttributionLine,
  type ParsedSection,
  type ValidationResult,
  type BreakdownEntry,
  parseAttributionLine,
  parseSections,
  buildSourceMap,
  validateSynthesisAttributions,
  generateBreakdown,
  stripAttributionLines,
} from './attribution.js';
export {
  type AnswerStyle,
  type SourceType,
  type AvoidSourceType,
  type TimeScope,
  type LocaleScope,
  type ResearchPlan,
  type OutputFormat,
  type ResearchContext,
  type InferResearchContextOptions,
} from './contextTypes.js';
export {
  isAnswerStyle,
  isSourceType,
  isAvoidSourceType,
  isTimeScope,
  isLocaleScope,
  isResearchPlan,
  isOutputFormat,
  isResearchContext,
} from './contextGuards.js';
// Zod schemas for direct use
export {
  ANSWER_STYLES,
  SOURCE_TYPES,
  AVOID_SOURCE_TYPES,
  AnswerStyleSchema,
  SourceTypeSchema,
  AvoidSourceTypeSchema,
  TimeScopeSchema,
  LocaleScopeSchema,
  ResearchPlanSchema,
  OutputFormatSchema,
  ResearchContextSchema,
} from './contextSchemas.js';
export {
  inferResearchContextPrompt,
  type InferResearchContextPromptInput,
} from './contextInference.js';
export {
  researchContextRepairPrompt,
  type ResearchContextRepairPromptInput,
} from './repairPrompt.js';
export {
  modelExtractionPrompt,
  parseModelExtractionResponse,
  MODEL_KEYWORDS,
  PROVIDER_DEFAULT_MODELS,
  SYNTHESIS_MODELS,
  DEFAULT_SYNTHESIS_MODEL,
  type AvailableModelInfo,
  type ModelExtractionPromptDeps,
  type ModelExtractionResponse,
} from './modelExtractionPrompt.js';
