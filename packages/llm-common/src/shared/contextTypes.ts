/**
 * Shared types for the context inference system.
 * These types are used by both research and synthesis context inference.
 *
 * Types are derived from Zod schemas - re-exported here for backwards compatibility.
 */

export {
  DOMAINS,
  type Domain,
  type Mode,
  type DefaultApplied,
  type SafetyInfo,
} from './contextSchemas.js';
