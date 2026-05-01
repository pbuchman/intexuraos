/**
 * Structured-output helper that drives an LLM client through:
 *   1. `client.generate(prompt, { promptType })`
 *   2. fenced-markdown stripping (```json … ``` or ``` … ```)
 *   3. `JSON.parse`
 *   4. Zod schema validation
 *   5. optional repair loop bounded by `maxRepairAttempts`
 *
 * On parse / validation failure, when a `repairBuilder` is provided, the
 * helper invokes it with the raw response and the {@link z.ZodError} to
 * obtain the next prompt and re-runs `client.generate`.
 *
 * The helper is structurally typed against the `LlmGenerateClient` shape
 * exported from `@intexuraos/llm-factory` to avoid an upward dependency on
 * that package (which would make `llm-utils` consumable only by clients
 * that are already wired to the factory).
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { Result } from '@intexuraos/common-core';
import type { LLMError } from '@intexuraos/llm-contract';

/**
 * Subset of the `GenerateResult` shape from `@intexuraos/llm-factory` that
 * this helper actually relies on. Repeated locally to keep `llm-utils` free
 * of a circular dependency.
 */
export interface StructuredGenerateResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

/**
 * Minimal client interface this helper consumes. Every concrete
 * `LlmGenerateClient` produced by `@intexuraos/llm-factory` satisfies it.
 */
export interface StructuredClient {
  generate: (
    prompt: string,
    options: { promptType: string } & Record<string, unknown>
  ) => Promise<Result<StructuredGenerateResult, LLMError>>;
}

/**
 * Parameters for {@link generateStructured}.
 */
export interface GenerateStructuredParams<T> {
  /** LLM client conforming to {@link StructuredClient}. */
  client: StructuredClient;
  /** Initial prompt text. */
  prompt: string;
  /** Zod schema the parsed JSON must satisfy. */
  schema: z.ZodType<T>;
  /** Semantic prompt-type identifier forwarded to the client. */
  promptType: string;
  /**
   * Builds a repair prompt from the raw LLM response and the Zod error.
   * When omitted, the helper performs a single attempt with no repair loop.
   */
  repairBuilder?: (raw: string, err: z.ZodError) => string;
  /**
   * Number of repair attempts allowed AFTER the initial attempt.
   * Defaults to `1` when `repairBuilder` is provided, else `0`.
   */
  maxRepairAttempts?: number;
  /**
   * Extra options forwarded into `client.generate`. `promptType` is
   * always supplied by the helper itself and is therefore omitted here.
   */
  options?: Record<string, unknown>;
}

/**
 * Successful structured-generate result.
 */
export interface GenerateStructuredOutput<T> {
  data: T;
  raw: string;
  usage: StructuredGenerateResult['usage'];
  /** How many repair iterations were needed (`0` means happy path). */
  repairAttempts: number;
}

/**
 * Discriminated error type for {@link generateStructured}.
 */
export type StructuredError =
  | { kind: 'llm'; error: LLMError }
  | { kind: 'validation'; raw: string; zodError: z.ZodError };

const FENCED = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;

function stripFences(content: string): string {
  const trimmed = content.trim();
  const match = FENCED.exec(trimmed);
  if (!match) return trimmed;
  // `noUncheckedIndexedAccess` widens the capture group to `string | undefined`,
  // even though the group is non-optional in FENCED. Fallback to `trimmed`.
  return match[1] ?? trimmed;
}

function makeParseError(raw: string): z.ZodError {
  return new z.ZodError([
    {
      code: 'custom',
      path: [],
      message: `Invalid JSON: ${raw.slice(0, 80)}`,
    },
  ]);
}

/**
 * Generates a structured object from an LLM client.
 *
 * @param params - See {@link GenerateStructuredParams}.
 * @returns A {@link Result} carrying the parsed object plus the raw response
 *          and usage counters, or a {@link StructuredError} discriminated by
 *          `kind: 'llm' | 'validation'`.
 */
export async function generateStructured<T>(
  params: GenerateStructuredParams<T>
): Promise<Result<GenerateStructuredOutput<T>, StructuredError>> {
  const maxRepair = params.maxRepairAttempts ?? (params.repairBuilder !== undefined ? 1 : 0);
  let currentPrompt = params.prompt;
  let attempt = 0;

  // Bounded by maxRepair + 1 attempts total; every branch returns explicitly,
  // so no fall-through return is needed (keeps branch coverage at 100%).
  for (;;) {
    const gen = await params.client.generate(currentPrompt, {
      ...(params.options ?? {}),
      promptType: params.promptType,
    });
    if (!gen.ok) {
      return { ok: false, error: { kind: 'llm', error: gen.error } };
    }
    const raw = gen.value.content;
    const stripped = stripFences(raw);

    let parsed: unknown;
    let parseSucceeded = false;
    try {
      parsed = JSON.parse(stripped);
      parseSucceeded = true;
    } catch {
      // fall through to repair / error path below
    }

    if (parseSucceeded) {
      const result = params.schema.safeParse(parsed);
      if (result.success) {
        return {
          ok: true,
          value: {
            data: result.data,
            raw,
            usage: gen.value.usage,
            repairAttempts: attempt,
          },
        };
      }
      if (params.repairBuilder !== undefined && attempt < maxRepair) {
        currentPrompt = params.repairBuilder(raw, result.error);
        attempt += 1;
        continue;
      }
      return { ok: false, error: { kind: 'validation', raw, zodError: result.error } };
    }

    const zodError = makeParseError(stripped);
    if (params.repairBuilder !== undefined && attempt < maxRepair) {
      currentPrompt = params.repairBuilder(raw, zodError);
      attempt += 1;
      continue;
    }
    return { ok: false, error: { kind: 'validation', raw, zodError } };
  }
}
