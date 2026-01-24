/**
 * Types specific to synthesis context inference.
 *
 * Types are derived from Zod schemas - re-exported here for backwards compatibility.
 */

export {
  type AdditionalSource,
  type LlmReport,
  type SynthesisGoal,
  type ConflictSeverity,
  type DetectedConflict,
  type SourcePreference,
  type SynthesisOutputFormat,
  type SynthesisContext,
  type InferSynthesisContextParams,
} from './contextSchemas.js';
