/**
 * OpenRouter Tool Calling Client.
 *
 * Implements the generic ToolCallingClient interface against OpenRouter's
 * OpenAI-compatible chat completions API.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  LlmProviders,
  type LLMError,
  type MatrixCorpusProviderCallUsageV1,
  type NormalizedUsage,
  type OwnerType,
  type ToolCallingClient,
  type ToolCallingMessage,
  type ToolCallingResult,
  type ToolDefinition,
} from '@intexuraos/llm-contract';
import { createUsageLogger, type UsageSink } from '@intexuraos/llm-pricing';
import type { Logger } from '@intexuraos/common-core';
import { normalizeUsage } from './costCalculator.js';
import type { OpenRouterUsage } from './types.js';

export interface OpenRouterToolCallingConfig {
  apiKey: string;
  model: string;
  userId: string;
  logger: Logger;
  usageSink: UsageSink;
  ownerType?: OwnerType;
  timeoutMs?: number;
  evidenceModelId?: string;
}

interface OpenRouterFunctionCall {
  name?: string;
  arguments?: string;
}

interface OpenRouterToolCall {
  id?: string;
  type?: 'function';
  function?: OpenRouterFunctionCall;
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenRouterToolCallingResponse {
  choices: {
    message: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
  }[];
  usage?: OpenRouterUsage;
}

const API_BASE_URL = 'https://openrouter.ai/api/v1';
const APP_TITLE = 'IntexuraOS';
const DEFAULT_TIMEOUT_MS = 840_000;
const DEFAULT_MAX_ITERATIONS = 5;
const MATRIX_PROVIDER_FAILURE_CODE = 'MATRIX_PROVIDER_CALL_FAILED';
const MATRIX_PROVIDER_FAILURE_MESSAGE = 'Matrix provider call failed';

function nonNegativeProviderCost(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

class OpenRouterApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'OpenRouterApiError';
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createOpenRouterToolCallingClient(
  config: OpenRouterToolCallingConfig
): ToolCallingClient {
  const {
    apiKey,
    model,
    userId,
    logger,
    usageSink,
    ownerType,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    evidenceModelId = model,
  } = config;
  const usageLogger = createUsageLogger({ logger, sink: usageSink });

  function trackUsage(
    usage: NormalizedUsage,
    success: boolean,
    durationMs: number,
    errorMessage?: string,
    providerReportedUsd?: number | null,
    promptType?: string
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.OpenRouter,
      model,
      callType: 'tool_calling',
      usage,
      success,
      durationMs,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(providerReportedUsd !== undefined &&
        providerReportedUsd !== null && { providerReportedUsd }),
      ...(ownerType !== undefined && { ownerType }),
      ...(promptType !== undefined && { promptType }),
    });
  }

  function extractUsage(usage?: OpenRouterUsage): {
    normalized: NormalizedUsage;
    providerReportedUsd: number | null;
  } {
    if (usage === undefined) {
      return {
        normalized: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        providerReportedUsd: null,
      };
    }
    const providerReportedUsd = nonNegativeProviderCost(usage.cost);
    return {
      normalized: normalizeUsage(usage.prompt_tokens, usage.completion_tokens, providerReportedUsd),
      providerReportedUsd,
    };
  }

  return {
    async run(params): Promise<Result<ToolCallingResult, LLMError>> {
      const {
        systemPrompt,
        messages,
        tools,
        toolChoice = 'required',
        maxIterations = DEFAULT_MAX_ITERATIONS,
        onExhausted,
        repairIterations,
        promptType,
      } = params;

      const conversation = buildInitialMessages(systemPrompt, messages);
      const toolMap = new Map<string, ToolDefinition>();
      for (const tool of tools) {
        toolMap.set(tool.name, tool);
      }

      const runStart = Date.now();
      let totalToolCalls = 0;
      let iteration = 0;
      let effectiveMax = maxIterations;
      let onExhaustedFn = onExhausted;
      const repairIters = repairIterations ?? 2;
      const providerCalls: MatrixCorpusProviderCallUsageV1[] = [];
      let aggregatedUsage: NormalizedUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
      let providerReportedUsd = 0;
      let responsesWithUsage = 0;
      let hasUnknownProviderCost = false;

      function completeUsage(): NormalizedUsage {
        if (hasUnknownProviderCost || responsesWithUsage === 0) {
          return {
            inputTokens: aggregatedUsage.inputTokens,
            outputTokens: aggregatedUsage.outputTokens,
            totalTokens: aggregatedUsage.totalTokens,
            costUsd: 0,
          };
        }
        return {
          inputTokens: aggregatedUsage.inputTokens,
          outputTokens: aggregatedUsage.outputTokens,
          totalTokens: aggregatedUsage.totalTokens,
          costUsd: providerReportedUsd,
          providerReportedUsd,
        };
      }

      function completeProviderReportedUsd(): number | null {
        return hasUnknownProviderCost || responsesWithUsage === 0 ? null : providerReportedUsd;
      }

      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          while (iteration < effectiveMax) {
            iteration++;
            const iterationStart = Date.now();
            const requestBody = buildRequestBody(
              model,
              conversation,
              tools,
              totalToolCalls,
              toolChoice
            );

            const response = await fetchWithTimeout(
              `${API_BASE_URL}/chat/completions`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                  'HTTP-Referer': 'https://intexuraos.cloud',
                  'X-Title': APP_TITLE,
                },
                body: JSON.stringify(requestBody),
              },
              timeoutMs
            );

            if (!response.ok) {
              const errorText = await response.text();
              throw new OpenRouterApiError(response.status, errorText);
            }

            const data = (await response.json()) as OpenRouterToolCallingResponse;
            const message = data.choices[0]?.message;
            const usage = extractUsage(data.usage);
            if (params.matrixCorpusContext !== undefined) {
              const providerCall: MatrixCorpusProviderCallUsageV1 = {
                context: {
                  ...params.matrixCorpusContext,
                  callOrdinal: params.matrixCorpusContext.callOrdinal + iteration - 1,
                },
                modelId: evidenceModelId,
                inputTokens: usage.normalized.inputTokens,
                outputTokens: usage.normalized.outputTokens,
                totalTokens: usage.normalized.totalTokens,
                ...(usage.providerReportedUsd === null
                  ? {}
                  : { providerReportedUsd: usage.providerReportedUsd }),
              };
              providerCalls.push(providerCall);
              await params.onMatrixCorpusProviderCall?.(providerCall);
            }
            aggregatedUsage = addUsage(aggregatedUsage, usage.normalized);
            responsesWithUsage++;
            if (usage.providerReportedUsd === null) {
              hasUnknownProviderCost = true;
            } else {
              providerReportedUsd += usage.providerReportedUsd;
            }

            const toolCalls = message?.tool_calls ?? [];
            if (toolCalls.length > 0) {
              totalToolCalls += toolCalls.length;
              conversation.push({
                role: 'assistant',
                content: message?.content ?? null,
                tool_calls: toolCalls,
              });

              for (const [index, toolCall] of toolCalls.entries()) {
                const toolResponse = await runToolCall(
                  toolMap,
                  toolCall,
                  logger,
                  iteration,
                  params.matrixCorpusContext !== undefined
                );
                conversation.push({
                  role: 'tool',
                  tool_call_id: toolCall.id ?? `call_${String(iteration)}_${String(index)}`,
                  name: toolCall.function?.name ?? '',
                  content: toolResponse,
                });
              }

              logger.info(
                {
                  iteration,
                  toolCalls: toolCalls.length,
                  usage: {
                    inputTokens: usage.normalized.inputTokens,
                    outputTokens: usage.normalized.outputTokens,
                    costUsd: usage.normalized.costUsd,
                  },
                  durationMs: Date.now() - iterationStart,
                },
                'OpenRouter tool calling: iteration with tool call'
              );
              continue;
            }

            const finalText = typeof message?.content === 'string' ? message.content : '';
            if (finalText === '') {
              trackUsage(
                completeUsage(),
                false,
                Date.now() - runStart,
                'Empty response from model',
                completeProviderReportedUsd(),
                promptType
              );
              return err({ code: 'API_ERROR', message: 'Empty response from model' });
            }

            logger.info(
              {
                iteration,
                totalToolCalls,
                finalTextLength: finalText.length,
                usage: {
                  inputTokens: aggregatedUsage.inputTokens,
                  outputTokens: aggregatedUsage.outputTokens,
                  costUsd: aggregatedUsage.costUsd,
                },
                durationMs: Date.now() - iterationStart,
              },
              'OpenRouter tool calling: completed'
            );

            trackUsage(
              completeUsage(),
              true,
              Date.now() - runStart,
              undefined,
              completeProviderReportedUsd(),
              promptType
            );

            return ok({
              content: finalText,
              toolCallsMade: totalToolCalls,
              iterationCount: iteration,
              usage: completeUsage(),
              ...(params.matrixCorpusContext === undefined ? {} : { providerCalls }),
            });
          }

          if (attempt === 0 && onExhaustedFn !== undefined) {
            const repairMessage = onExhaustedFn({
              iterationCount: iteration,
              toolCallsMade: totalToolCalls,
            });
            onExhaustedFn = undefined;
            if (repairMessage !== undefined) {
              logger.info(
                { iteration, totalToolCalls },
                'OpenRouter tool calling: repair message injected'
              );
              conversation.push({ role: 'user', content: repairMessage });
              effectiveMax = iteration + repairIters;
              continue;
            }
          }
          break;
        }

        trackUsage(
          completeUsage(),
          false,
          Date.now() - runStart,
          'Tool calling loop exceeded maxIterations',
          completeProviderReportedUsd(),
          promptType
        );
        return err({
          code: 'API_ERROR',
          message: 'Tool calling loop exceeded maxIterations',
        });
      } catch (error: unknown) {
        hasUnknownProviderCost = true;
        const matrixCorpus = params.matrixCorpusContext !== undefined;
        const errorMsg = matrixCorpus ? MATRIX_PROVIDER_FAILURE_CODE : getErrorMessage(error);
        trackUsage(
          completeUsage(),
          false,
          Date.now() - runStart,
          errorMsg,
          completeProviderReportedUsd(),
          promptType
        );
        const mappedError = mapOpenRouterError(error);
        return err(
          matrixCorpus
            ? { code: mappedError.code, message: MATRIX_PROVIDER_FAILURE_MESSAGE }
            : mappedError
        );
      }
    },
  };
}

function buildInitialMessages(
  systemPrompt: string,
  messages: ToolCallingMessage[]
): OpenRouterMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map(
      (message): OpenRouterMessage => ({
        role: message.role,
        content: message.content,
      })
    ),
  ];
}

function buildRequestBody(
  model: string,
  messages: OpenRouterMessage[],
  tools: ToolDefinition[],
  totalToolCalls: number,
  toolChoice: 'auto' | 'required'
): Record<string, unknown> {
  return {
    model,
    messages,
    temperature: 0.2,
    ...(tools.length > 0 && {
      tools: tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: totalToolCalls === 0 ? toolChoice : 'auto',
    }),
  };
}

async function runToolCall(
  toolMap: Map<string, ToolDefinition>,
  toolCall: OpenRouterToolCall,
  logger: Logger,
  iteration: number,
  matrixCorpus: boolean
): Promise<string> {
  const toolName = toolCall.function?.name ?? '';
  const toolArgs = parseToolArgs(toolCall.function?.arguments);
  const toolDef = toolMap.get(toolName);

  if (toolDef === undefined) {
    // Sentry INTEXURAOS-HETZNER-3J: a hallucinated tool name is a normal
    // self-correction signal — we echo an error back to the model so it can
    // retry with a real tool. Page noise; suppress while keeping stdout log.
    logger.warn(
      matrixCorpus
        ? { iteration, errorCode: 'UNKNOWN_TOOL_SELECTION', _skipSentry: true }
        : { iteration, toolName, _skipSentry: true },
      'OpenRouter tool calling: hallucinated tool name'
    );
    return JSON.stringify({ error: matrixCorpus ? 'Unknown tool' : `Unknown tool: ${toolName}` });
  }

  try {
    return await toolDef.run(toolArgs);
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    logger.warn(
      matrixCorpus
        ? { iteration, errorCode: 'TOOL_CALLBACK_REJECTED', _skipSentry: true }
        : { iteration, toolName, error: errorMsg },
      'OpenRouter tool calling: run callback threw'
    );
    return JSON.stringify({ error: matrixCorpus ? 'Tool execution failed' : errorMsg });
  }
}

function parseToolArgs(rawArgs: string | undefined): Record<string, unknown> {
  if (rawArgs === undefined || rawArgs === '') {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

function mapOpenRouterError(error: unknown): LLMError {
  if (error instanceof OpenRouterApiError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (error.status === 503) return { code: 'OVERLOADED', message };
    return { code: 'API_ERROR', message };
  }

  const message = getErrorMessage(error);
  if (/timeout|fetch failed|aborted/i.test(message)) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}
