/**
 * Gemini Tool Calling Client.
 *
 * Implements the agent loop for Gemini function calling:
 * 1. Send messages + functionDeclarations to Gemini
 * 2. If response contains functionCall → execute run callback → send functionResponse
 * 3. Loop until no more tool calls or maxIterations reached
 * 4. Return final text + aggregated usage
 *
 * @packageDocumentation
 */

import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import type { Content, FunctionDeclaration, Part } from '@google/genai';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  LLMError,
  MatrixCorpusProviderCallUsageV1,
  NormalizedUsage,
  ToolCallingClient,
  ToolCallingResult,
  ToolDefinition,
  Gemini25Flash,
} from '@intexuraos/llm-contract';
import { LlmProviders } from '@intexuraos/llm-contract';
import { createUsageLogger, type UsageSink } from '@intexuraos/llm-pricing';
import type { Logger } from '@intexuraos/common-core';
import { normalizeUsage } from './costCalculator.js';

const DEFAULT_MAX_ITERATIONS = 5;
const MATRIX_PROVIDER_FAILURE_CODE = 'MATRIX_PROVIDER_CALL_FAILED';
const MATRIX_PROVIDER_FAILURE_MESSAGE = 'Matrix provider call failed';

/**
 * Configuration for creating a Gemini tool calling client.
 * Factory-level config — not exposed in the abstract ToolCallingClient interface.
 */
export interface ToolCallingClientConfig {
  apiKey: string;
  model: Gemini25Flash;
  userId: string;
  logger: Logger;
  /** Usage sink. Required — pass NoopUsageSink to explicitly opt out. */
  usageSink: UsageSink;
  evidenceModelId?: string;
}

/**
 * Create a Gemini-backed tool calling client.
 */
export function createGeminiToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { model, userId, logger, usageSink, evidenceModelId = model } = config;

  const usageLogger = createUsageLogger({ logger, sink: usageSink });

  function trackUsage(
    usage: NormalizedUsage,
    success: boolean,
    durationMs: number,
    errorMessage?: string,
    promptType?: string
  ): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.Google,
      model,
      callType: 'tool_calling',
      usage,
      success,
      durationMs,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(promptType !== undefined && { promptType }),
    });
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

      // Build function declarations (strip `run` callbacks — only schema goes to Gemini)
      const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));

      // Build initial conversation contents
      const contents: Content[] = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      // Build tool lookup map
      const toolMap = new Map<string, ToolDefinition>();
      for (const t of tools) {
        toolMap.set(t.name, t);
      }

      const runStart = Date.now();
      let totalToolCalls = 0;
      let iteration = 0;
      let aggregatedUsage: NormalizedUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
      // Track last response parts for maxIterations fallback
      let lastResponseParts: Part[] = [];

      let effectiveMax = maxIterations;
      let onExhaustedFn = onExhausted;
      const repairIters = repairIterations ?? 2;
      const providerCalls: MatrixCorpusProviderCallUsageV1[] = [];

      try {
        // Outer: allows one re-entry after repair injection
        for (let attempt = 0; attempt < 2; attempt++) {
          while (iteration < effectiveMax) {
            iteration++;
            const iterationStart = Date.now();

            const response = await ai.models.generateContent({
              model,
              contents,
              config: {
                systemInstruction: systemPrompt,
                ...(functionDeclarations.length > 0 && {
                  tools: [{ functionDeclarations }],
                  toolConfig: {
                    functionCallingConfig: {
                      mode:
                        totalToolCalls === 0
                          ? firstTurnFunctionCallingMode(toolChoice)
                          : FunctionCallingConfigMode.AUTO,
                    },
                  },
                }),
              },
            });

            // Aggregate usage
            const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
            const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
            const thinkingTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
            const iterationUsage = normalizeUsage(inputTokens, outputTokens, false, thinkingTokens);
            if (params.matrixCorpusContext !== undefined) {
              const providerCall: MatrixCorpusProviderCallUsageV1 = {
                context: {
                  ...params.matrixCorpusContext,
                  callOrdinal: params.matrixCorpusContext.callOrdinal + iteration - 1,
                },
                modelId: evidenceModelId,
                inputTokens: iterationUsage.inputTokens,
                outputTokens: iterationUsage.outputTokens,
                totalTokens: iterationUsage.totalTokens,
              };
              providerCalls.push(providerCall);
              await params.onMatrixCorpusProviderCall?.(providerCall);
            }
            aggregatedUsage = addUsage(aggregatedUsage, iterationUsage);

            // Extract parts from response
            const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
            lastResponseParts = parts;

            // Check for function call
            const functionCallPart = parts.find((p) => p.functionCall !== undefined);

            if (functionCallPart?.functionCall !== undefined) {
              const { name: toolName, args: toolArgs } = functionCallPart.functionCall;
              const resolvedName = toolName ?? '';
              const resolvedArgs = toolArgs ?? {};

              totalToolCalls++;

              // Find matching tool definition
              const toolDef = toolMap.get(resolvedName);
              let toolResponse: string;

              if (toolDef === undefined) {
                // Hallucinated tool name — send error back for self-correction.
                // Sentry INTEXURAOS-HETZNER-3J: this is an expected self-correction
                // signal, not an application error; suppress from Sentry while
                // preserving stdout/Cloud Logging output.
                toolResponse = JSON.stringify({
                  error:
                    params.matrixCorpusContext === undefined
                      ? `Unknown tool: ${resolvedName}`
                      : 'Unknown tool',
                });
                logger.warn(
                  params.matrixCorpusContext === undefined
                    ? { iteration, toolName: resolvedName, _skipSentry: true }
                    : { iteration, errorCode: 'UNKNOWN_TOOL_SELECTION', _skipSentry: true },
                  'Tool calling: hallucinated tool name'
                );
              } else {
                try {
                  toolResponse = await toolDef.run(resolvedArgs);
                } catch (runError: unknown) {
                  const runErrorMsg = getErrorMessage(runError);
                  toolResponse = JSON.stringify({
                    error:
                      params.matrixCorpusContext === undefined
                        ? runErrorMsg
                        : 'Tool execution failed',
                  });
                  logger.warn(
                    params.matrixCorpusContext === undefined
                      ? { iteration, toolName: resolvedName, error: runErrorMsg }
                      : {
                          iteration,
                          errorCode: 'TOOL_CALLBACK_REJECTED',
                          _skipSentry: true,
                        },
                    'Tool calling: run callback threw'
                  );
                }
              }

              const durationMs = Date.now() - iterationStart;
              logger.info(
                {
                  iteration,
                  ...(params.matrixCorpusContext === undefined
                    ? {
                        toolName: resolvedName,
                        toolArgs: resolvedArgs,
                        toolResponseTruncated:
                          toolResponse.length > 200
                            ? toolResponse.slice(0, 200) + '...'
                            : toolResponse,
                      }
                    : {}),
                  usage: {
                    inputTokens: iterationUsage.inputTokens,
                    outputTokens: iterationUsage.outputTokens,
                    costUsd: iterationUsage.costUsd,
                  },
                  durationMs,
                },
                'Tool calling: iteration with tool call'
              );

              // Append the model's function call and our response to conversation
              contents.push({
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: resolvedName,
                      args: resolvedArgs,
                    },
                  },
                ],
              });
              contents.push({
                role: 'user',
                parts: [
                  {
                    functionResponse: {
                      name: resolvedName,
                      response: { result: toolResponse },
                    },
                  },
                ],
              });

              // Continue loop
              continue;
            }

            // No function call — check for text response
            const textPart = parts.find((p) => p.text !== undefined);
            const finalText = textPart?.text ?? '';

            if (finalText === '') {
              // Empty response
              trackUsage(
                aggregatedUsage,
                false,
                Date.now() - runStart,
                'Empty response from model',
                promptType
              );
              return err({
                code: 'API_ERROR',
                message: 'Empty response from model',
              });
            }

            // Success — return final text
            const durationMs = Date.now() - iterationStart;
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
                durationMs,
              },
              'Tool calling: completed'
            );

            trackUsage(aggregatedUsage, true, Date.now() - runStart, undefined, promptType);

            return ok({
              content: finalText,
              toolCallsMade: totalToolCalls,
              iterationCount: iteration,
              usage: aggregatedUsage,
              ...(params.matrixCorpusContext === undefined ? {} : { providerCalls }),
            });
          }

          // Post-loop: try repair on first attempt only
          if (attempt === 0 && onExhaustedFn !== undefined) {
            const repairMessage = onExhaustedFn({
              iterationCount: iteration,
              toolCallsMade: totalToolCalls,
            });
            onExhaustedFn = undefined;
            if (repairMessage !== undefined) {
              logger.info({ iteration, totalToolCalls }, 'Tool calling: repair message injected');
              contents.push({ role: 'user', parts: [{ text: repairMessage }] });
              effectiveMax = iteration + repairIters;
              continue; // re-enter outer for loop → inner while loop runs again
            }
          }
          break; // no repair needed or repair already done
        }

        // maxIterations exhausted — check if last Gemini response had text
        const lastTextPart = lastResponseParts.find((p) => p.text !== undefined);
        const lastText = lastTextPart?.text ?? '';

        if (lastText !== '') {
          trackUsage(aggregatedUsage, true, Date.now() - runStart, undefined, promptType);

          return ok({
            content: lastText,
            toolCallsMade: totalToolCalls,
            iterationCount: iteration,
            usage: aggregatedUsage,
            ...(params.matrixCorpusContext === undefined ? {} : { providerCalls }),
          });
        }

        trackUsage(
          aggregatedUsage,
          false,
          Date.now() - runStart,
          'Tool calling loop exceeded maxIterations',
          promptType
        );
        return err({
          code: 'API_ERROR',
          message: 'Tool calling loop exceeded maxIterations',
        });
      } catch (error: unknown) {
        const matrixCorpus = params.matrixCorpusContext !== undefined;
        const errorMsg = matrixCorpus ? MATRIX_PROVIDER_FAILURE_CODE : getErrorMessage(error);
        trackUsage(aggregatedUsage, false, Date.now() - runStart, errorMsg, promptType);
        const mappedError = mapGeminiError(error);
        return err(
          matrixCorpus
            ? { code: mappedError.code, message: MATRIX_PROVIDER_FAILURE_MESSAGE }
            : mappedError
        );
      }
    },
  };
}

function firstTurnFunctionCallingMode(
  toolChoice: 'auto' | 'required'
): typeof FunctionCallingConfigMode.AUTO | typeof FunctionCallingConfigMode.ANY {
  return toolChoice === 'auto' ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.ANY;
}

function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  const thinkingTokens = (a.thinkingTokens ?? 0) + (b.thinkingTokens ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd,
    ...(thinkingTokens > 0 && { thinkingTokens }),
  };
}

function mapGeminiError(error: unknown): LLMError {
  const message = getErrorMessage(error);
  if (message.includes('API_KEY')) return { code: 'INVALID_KEY', message };
  if (message.includes('429') || message.includes('quota')) {
    return { code: 'RATE_LIMITED', message };
  }
  if (message.includes('timeout')) return { code: 'TIMEOUT', message };
  if (message.includes('SAFETY') || message.includes('blocked')) {
    return { code: 'CONTENT_FILTERED', message };
  }
  return { code: 'API_ERROR', message };
}
