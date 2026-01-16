/**
 * Research domain module.
 *
 * Contains prompts and utilities for research and synthesis operations.
 */

export { buildResearchPrompt } from './researchPrompt.js';
export {
  buildSynthesisPrompt,
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
export { buildInferResearchContextPrompt } from './contextInference.js';
export { buildResearchContextRepairPrompt } from './repairPrompt.js';
