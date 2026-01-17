/**
 * Synthesis domain module.
 *
 * Contains prompts and utilities for synthesis operations.
 */

export {
  type SynthesisGoal,
  type ConflictSeverity,
  type DetectedConflict,
  type SourcePreference,
  type SynthesisOutputFormat,
  type SynthesisContext,
  type InferSynthesisContextParams,
  type AdditionalSource,
  type LlmReport,
} from './contextTypes.js';
export {
  isSynthesisGoal,
  isConflictSeverity,
  isDetectedConflict,
  isSourcePreference,
  isSynthesisOutputFormat,
  isSynthesisContext,
} from './contextGuards.js';
export { buildInferSynthesisContextPrompt } from './contextInference.js';
export { buildSynthesisContextRepairPrompt } from './repairPrompt.js';
