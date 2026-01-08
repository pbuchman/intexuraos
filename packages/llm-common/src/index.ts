/**
 * @intexuraos/llm-common
 *
 * LLM-specific utilities for prompts, context inference, attribution, and redaction.
 * Pure utilities with zero infrastructure dependencies.
 */

// Research prompt builder
export { buildResearchPrompt } from './researchPrompt.js';

// Synthesis prompt builder
export {
  buildSynthesisPrompt,
  type SynthesisReport,
  type AdditionalSource,
  /** @deprecated Use AdditionalSource instead */
  type ExternalReport,
} from './synthesisPrompt.js';

// Context inference module
export {
  // Types
  DOMAINS,
  type Domain,
  type Mode,
  type AnswerStyle,
  type SourceType,
  type AvoidSourceType,
  type SynthesisGoal,
  type ConflictSeverity,
  type DefaultApplied,
  type TimeScope,
  type LocaleScope,
  type ResearchPlan,
  type OutputFormat,
  type SafetyInfo,
  type ResearchContext,
  type DetectedConflict,
  type SourcePreference,
  type SynthesisOutputFormat,
  type SynthesisContext,
  type LlmReport,
  type AdditionalSource as ContextAdditionalSource,
  type InferResearchContextOptions,
  type InferSynthesisContextParams,
  // Guards
  isResearchContext,
  isSynthesisContext,
  // Prompt builders
  buildInferResearchContextPrompt,
  buildInferSynthesisContextPrompt,
} from './context/index.js';

// Attribution system
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

// Security utilities
export { redactToken, redactObject, SENSITIVE_FIELDS } from './redaction.js';

