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
import { withRetry } from '@intexuraos/llm-utils';
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
  /** Maximum transient attempts for each provider iteration. Default: 1. */
  maxAttempts?: number;
  /** Optional absolute wall-clock deadline shared by all iterations and retries. */
  deadlineAtMs?: number;
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
const REQUIRED_TOOL_RETRY_MESSAGE =
  'Call one of the provided tools now. A tool call is required for this request; do not return final text before calling a tool.';
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

async function withRequestTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveRequestTimeoutMs(timeoutMs: number, deadlineAtMs?: number): number {
  if (deadlineAtMs === undefined) return timeoutMs;
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) throw new Error('OpenRouter request deadline timeout');
  return Math.min(timeoutMs, remainingMs);
}

class OpenRouterLlmError extends Error {
  constructor(public readonly llmError: LLMError) {
    super(llmError.message);
    this.name = 'OpenRouterLlmError';
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
    maxAttempts = 1,
    deadlineAtMs,
    evidenceModelId = model,
  } = config;
  const usageLogger = createUsageLogger({ logger, sink: usageSink });

  async function postChatCompletion(
    requestBody: Record<string, unknown>
  ): Promise<OpenRouterToolCallingResponse> {
    return await withRequestTimeout(
      resolveRequestTimeoutMs(timeoutMs, deadlineAtMs),
      async (signal) => {
        const response = await fetch(`${API_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://intexuraos.cloud',
            'X-Title': APP_TITLE,
          },
          body: JSON.stringify(requestBody),
          signal,
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new OpenRouterApiError(response.status, errorText);
        }
        return (await response.json()) as OpenRouterToolCallingResponse;
      }
    );
  }

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
      model: evidenceModelId,
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
      let acceptedToolCallMade = false;
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
      const suppressSingleToolAfterAcceptedCall = isMiniMaxM3Model(model) && tools.length === 1;
      const requireAcceptedToolCall = isMiniMaxM3Model(model);
      const retryOptions = {
        maxAttempts,
        baseDelayMs: 500,
        ...(deadlineAtMs === undefined ? {} : { deadlineAtMs }),
      };

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

      async function recordProviderResponse(
        data: OpenRouterToolCallingResponse,
        callOrdinal: number
      ): Promise<ReturnType<typeof extractUsage>> {
        const usage = extractUsage(data.usage);
        if (params.matrixCorpusContext !== undefined) {
          const providerCall: MatrixCorpusProviderCallUsageV1 = {
            context: {
              ...params.matrixCorpusContext,
              callOrdinal: params.matrixCorpusContext.callOrdinal + callOrdinal - 1,
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
        return usage;
      }

      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          while (iteration < effectiveMax) {
            iteration++;
            const iterationStart = Date.now();
            const requestBody = buildRequestBody(
              model,
              conversation,
              acceptedToolCallMade && suppressSingleToolAfterAcceptedCall ? [] : tools,
              acceptedToolCallMade || (!requireAcceptedToolCall && totalToolCalls > 0),
              toolChoice,
              iteration
            );

            const responseResult = await withRetry(async () => {
              try {
                return ok(await postChatCompletion(requestBody));
              } catch (error) {
                return err(mapOpenRouterError(error));
              }
            }, retryOptions);
            if (!responseResult.ok) throw new OpenRouterLlmError(responseResult.error);
            const data = responseResult.value;
            const message = data.choices[0]?.message;
            const usage = await recordProviderResponse(data, iteration);

            const toolCalls = message?.tool_calls ?? [];
            if (toolCalls.length > 0) {
              conversation.push({
                role: 'assistant',
                content: message?.content ?? null,
                tool_calls: toolCalls,
              });

              for (const [index, toolCall] of toolCalls.entries()) {
                if (acceptedToolCallMade && suppressSingleToolAfterAcceptedCall) {
                  conversation.push({
                    role: 'tool',
                    tool_call_id: toolCall.id ?? `call_${String(iteration)}_${String(index)}`,
                    name: toolCall.function?.name ?? '',
                    content: JSON.stringify({ error: 'Tool already completed' }),
                  });
                  logger.info(
                    { iteration },
                    'OpenRouter tool calling: skipped duplicate MiniMax single-tool call'
                  );
                  continue;
                }
                const toolResponse = await runToolCall(
                  toolMap,
                  toolCall,
                  logger,
                  iteration,
                  params.matrixCorpusContext !== undefined
                );
                totalToolCalls++;
                if (toolResponse.accepted) acceptedToolCallMade = true;
                conversation.push({
                  role: 'tool',
                  tool_call_id: toolCall.id ?? `call_${String(iteration)}_${String(index)}`,
                  name: toolCall.function?.name ?? '',
                  content: toolResponse.content,
                });
                if (toolResponse.stopAfterRun) {
                  const terminalContent =
                    typeof message?.content === 'string' ? message.content : '';
                  logger.info(
                    {
                      iteration,
                      totalToolCalls,
                      usage: {
                        inputTokens: aggregatedUsage.inputTokens,
                        outputTokens: aggregatedUsage.outputTokens,
                        costUsd: aggregatedUsage.costUsd,
                      },
                      durationMs: Date.now() - iterationStart,
                    },
                    'OpenRouter tool calling: stopped after terminal tool callback'
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
                    content: terminalContent,
                    toolCallsMade: totalToolCalls,
                    iterationCount: iteration,
                    usage: completeUsage(),
                    ...(params.matrixCorpusContext === undefined ? {} : { providerCalls }),
                  });
                }
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
            if (
              tools.length > 0 &&
              toolChoice === 'required' &&
              !acceptedToolCallMade &&
              (requireAcceptedToolCall || totalToolCalls === 0)
            ) {
              conversation.push({ role: 'assistant', content: finalText });
              conversation.push({
                role: 'user',
                content: requiredToolRetryMessage(tools),
              });
              logger.info({ iteration }, 'OpenRouter tool calling: retrying required tool choice');
              continue;
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

        const fallbackTool = requiredToolArgsFallback(
          model,
          tools,
          toolChoice,
          acceptedToolCallMade,
          onExhausted === undefined
        );
        if (fallbackTool !== undefined) {
          iteration++;
          const responseResult = await withRetry(async () => {
            try {
              return ok(
                await postChatCompletion(
                  buildToolArgsFallbackRequestBody(model, systemPrompt, messages, fallbackTool)
                )
              );
            } catch (error) {
              return err(mapOpenRouterError(error));
            }
          }, retryOptions);
          if (!responseResult.ok) throw new OpenRouterLlmError(responseResult.error);
          const data = responseResult.value;
          await recordProviderResponse(data, iteration);
          const fallbackArgs = parsePromptJsonObject(data.choices[0]?.message.content);
          if (fallbackArgs !== undefined) {
            const toolResponse = await runToolCall(
              toolMap,
              {
                id: `fallback_${String(iteration)}`,
                type: 'function',
                function: {
                  name: fallbackTool.name,
                  arguments: JSON.stringify(fallbackArgs),
                },
              },
              logger,
              iteration,
              params.matrixCorpusContext !== undefined
            );
            totalToolCalls++;
            if (toolResponse.accepted) {
              if (fallbackTool.stopAfterRun !== true) {
                const fallbackToolCallId = `fallback_${String(iteration)}`;
                const completionConversation = buildInitialMessages(systemPrompt, messages);
                completionConversation.push({
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: fallbackToolCallId,
                      type: 'function',
                      function: {
                        name: fallbackTool.name,
                        arguments: JSON.stringify(fallbackArgs),
                      },
                    },
                  ],
                });
                completionConversation.push({
                  role: 'tool',
                  tool_call_id: fallbackToolCallId,
                  name: fallbackTool.name,
                  content: toolResponse.content,
                });
                iteration++;
                const completionResponseResult = await withRetry(async () => {
                  try {
                    return ok(
                      await postChatCompletion(
                        buildRequestBody(model, completionConversation, [], true, 'auto', iteration)
                      )
                    );
                  } catch (error) {
                    return err(mapOpenRouterError(error));
                  }
                }, retryOptions);
                if (!completionResponseResult.ok) {
                  throw new OpenRouterLlmError(completionResponseResult.error);
                }
                const completionData = completionResponseResult.value;
                await recordProviderResponse(completionData, iteration);
                const completionContent = completionData.choices[0]?.message.content;
                if (typeof completionContent === 'string' && completionContent !== '') {
                  logger.info(
                    { iteration, totalToolCalls },
                    'OpenRouter tool calling: rendered MiniMax fallback tool result'
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
                    content: completionContent,
                    toolCallsMade: totalToolCalls,
                    iterationCount: iteration,
                    usage: completeUsage(),
                    ...(params.matrixCorpusContext === undefined ? {} : { providerCalls }),
                  });
                }
              } else {
                logger.info(
                  { iteration, totalToolCalls },
                  'OpenRouter tool calling: completed MiniMax required-tool argument fallback'
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
                  content: '',
                  toolCallsMade: totalToolCalls,
                  iterationCount: iteration,
                  usage: completeUsage(),
                  ...(params.matrixCorpusContext === undefined ? {} : { providerCalls }),
                });
              }
            }
          }
          logger.warn(
            {
              iteration,
              errorCode: 'MINIMAX_REQUIRED_TOOL_ARGUMENT_FALLBACK_REJECTED',
              ...(params.matrixCorpusContext === undefined ? {} : { _skipSentry: true }),
            },
            'OpenRouter tool calling: MiniMax required-tool argument fallback rejected'
          );
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
  acceptedToolCallMade: boolean,
  toolChoice: 'auto' | 'required',
  iteration: number
): Record<string, unknown> {
  const onlyTool = tools.length === 1 ? tools[0] : undefined;
  const initialToolChoice =
    toolChoice === 'required' && onlyTool !== undefined && iteration === 1
      ? { type: 'function', function: { name: onlyTool.name } }
      : toolChoice;
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
      tool_choice: acceptedToolCallMade ? 'auto' : initialToolChoice,
    }),
  };
}

function requiredToolRetryMessage(tools: ToolDefinition[]): string {
  const onlyTool = tools.length === 1 ? tools[0] : undefined;
  if (onlyTool === undefined) return REQUIRED_TOOL_RETRY_MESSAGE;
  return `Call the required ${onlyTool.name} tool now with arguments derived from the original request. Do not return final text before calling the tool.`;
}

function requiredToolArgsFallback(
  model: string,
  tools: ToolDefinition[],
  toolChoice: 'auto' | 'required',
  acceptedToolCallMade: boolean,
  allowFallback: boolean
): ToolDefinition | undefined {
  if (
    !allowFallback ||
    !isMiniMaxM3Model(model) ||
    toolChoice !== 'required' ||
    acceptedToolCallMade ||
    tools.length !== 1
  ) {
    return undefined;
  }
  return tools[0];
}

function isMiniMaxM3Model(model: string): boolean {
  return /^(?:or:)?minimax\/minimax-m3$/iu.test(model);
}

function buildToolArgsFallbackRequestBody(
  model: string,
  systemPrompt: string,
  messages: ToolCallingMessage[],
  tool: ToolDefinition
): Record<string, unknown> {
  const fallbackInstruction = [
    `Return only the JSON object of arguments for the required ${tool.name} tool.`,
    'Derive every argument from the original user request and conversation.',
    'Do not include markdown, commentary, the tool name, or an outer wrapper.',
    `Tool purpose: ${tool.description}`,
    `Arguments JSON Schema: ${JSON.stringify(tool.parameters)}`,
  ].join('\n');
  return {
    model,
    messages: [
      ...buildInitialMessages(systemPrompt, messages),
      { role: 'user', content: fallbackInstruction },
    ],
    temperature: 0,
  };
}

async function runToolCall(
  toolMap: Map<string, ToolDefinition>,
  toolCall: OpenRouterToolCall,
  logger: Logger,
  iteration: number,
  matrixCorpus: boolean
): Promise<Readonly<{ accepted: boolean; content: string; stopAfterRun: boolean }>> {
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
    return {
      accepted: false,
      content: JSON.stringify({
        error: matrixCorpus ? 'Unknown tool' : `Unknown tool: ${toolName}`,
      }),
      stopAfterRun: false,
    };
  }

  try {
    return {
      accepted: true,
      content: await toolDef.run(toolArgs),
      stopAfterRun: toolDef.stopAfterRun === true,
    };
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    logger.warn(
      matrixCorpus
        ? { iteration, errorCode: 'TOOL_CALLBACK_REJECTED', _skipSentry: true }
        : { iteration, toolName, error: errorMsg },
      'OpenRouter tool calling: run callback threw'
    );
    return {
      accepted: false,
      content: JSON.stringify({ error: matrixCorpus ? 'Tool execution failed' : errorMsg }),
      stopAfterRun: false,
    };
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

function parsePromptJsonObject(
  rawContent: string | null | undefined
): Record<string, unknown> | undefined {
  if (typeof rawContent !== 'string') return undefined;
  const trimmed = rawContent.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
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
  if (error instanceof OpenRouterLlmError) return error.llmError;
  if (error instanceof OpenRouterApiError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (error.status >= 500) return { code: 'OVERLOADED', message };
    return { code: 'API_ERROR', message };
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'TIMEOUT', message: error.message };
  }

  const message = getErrorMessage(error);
  if (/timeout|fetch failed|aborted/i.test(message)) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}
