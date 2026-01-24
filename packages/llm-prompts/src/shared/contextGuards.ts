/**
 * Shared runtime type guards for context inference.
 * These guards are used by both research and synthesis context inference.
 *
 * Type guards use Zod schemas internally for validation.
 */

import type { DefaultApplied, Domain, Mode, SafetyInfo } from './contextSchemas.js';
import {
  DefaultAppliedSchema,
  DOMAINS,
  DomainSchema,
  MODES,
  ModeSchema,
  SafetyInfoSchema,
} from './contextSchemas.js';
import type { Logger } from 'pino';

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDomain(value: unknown): value is Domain {
  return DomainSchema.safeParse(value).success;
}

export function isMode(value: unknown): value is Mode {
  return ModeSchema.safeParse(value).success;
}

export function isDefaultApplied(value: unknown): value is DefaultApplied {
  return DefaultAppliedSchema.safeParse(value).success;
}

export function isSafetyInfo(value: unknown): value is SafetyInfo {
  return SafetyInfoSchema.safeParse(value).success;
}

/**
 * Validation guards with error logging.
 *
 * These functions validate values and log detailed error messages when validation fails.
 * Use these in production to track LLM response quality issues.
 */

export function validateDomain(value: unknown, logger: Logger): value is Domain {
  const result = DomainSchema.safeParse(value);
  if (!result.success) {
    logger.warn(
      {
        received: value,
        error: result.error.format(),
      },
      `Domain validation failed - expected one of: ${DOMAINS.join(', ')}`
    );
    return false;
  }
  return true;
}

export function validateMode(value: unknown, logger: Logger): value is Mode {
  const result = ModeSchema.safeParse(value);
  if (!result.success) {
    logger.warn(
      {
        received: value,
        error: result.error.format(),
      },
      `Mode validation failed - expected one of: ${MODES.join(', ')}`
    );
    return false;
  }
  return true;
}
