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
  ModelPricing,
  NormalizedUsage,
  ToolCallingClient,
  ToolCallingResult,
  ToolDefinition,
  ToolCallingModel,
} from '@intexuraos/llm-contract';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { AuditSink } from '@intexuraos/llm-audit';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import { createUsageLogger, type UsageSink } from '@intexuraos/llm-pricing';
import type { Logger } from '@intexuraos/common-core';
import { normalizeUsage } from './costCalculator.js';

const DEFAULT_MAX_ITERATIONS = 5;

/**
 * Self-contained pricing for tool calling models.
 * Same pattern as VERIFIER_PRICING in completion-verifier.ts.
 * Bypasses code-agent's pricingContext (which throws on pricing operations).
 */
export const TOOL_CALLING_PRICING: Record<ToolCallingModel, ModelPricing> = {
  [LlmModels.Gemini25Flash]: {
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 2.0,
    groundingCostPerRequest: 0,
  },
};

/**
 * Configuration for creating a Gemini tool calling client.
 * Factory-level config — not exposed in the abstract ToolCallingClient interface.
 */
export interface ToolCallingClientConfig {
  apiKey: string;
  model: ToolCallingModel;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  auditSink?: AuditSink;
  usageSink?: UsageSink;
}

/**
 * Create a Gemini-backed tool calling client.
 */
export function createGeminiToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { model, userId, pricing, logger, auditSink, usageSink } = config;

  const usageLogger = createUsageLogger({
    logger,
    ...(usageSink !== undefined && { sink: usageSink }),
  });

  function trackUsage(usage: NormalizedUsage, success: boolean, errorMessage?: string): void {
    void usageLogger.log({
      userId,
      provider: LlmProviders.Google,
      model,
      callType: 'tool_calling',
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
    });
  }

  return {
    async run(params): Promise<Result<ToolCallingResult, LLMError>> {
      const {
        systemPrompt,
        messages,
        tools,
        maxIterations = DEFAULT_MAX_ITERATIONS,
        onExhausted,
        repairIterations,
      } = params;

      const auditContext: AuditContext = createAuditContext(
        {
          provider: LlmProviders.Google,
          model,
          method: 'toolCalling',
          prompt: systemPrompt,
          startedAt: new Date(),
          userId,
        },
        auditSink !== undefined ? { sink: auditSink } : undefined
      );

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
                          ? FunctionCallingConfigMode.ANY
                          : FunctionCallingConfigMode.AUTO,
                    },
                  },
                }),
              },
            });

            // Aggregate usage
            const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
            const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
            const iterationUsage = normalizeUsage(inputTokens, outputTokens, false, pricing);
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
                // Hallucinated tool name — send error back for self-correction
                toolResponse = JSON.stringify({
                  error: `Unknown tool: ${resolvedName}`,
                });
                logger.warn(
                  { iteration, toolName: resolvedName },
                  'Tool calling: hallucinated tool name'
                );
              } else {
                try {
                  toolResponse = await toolDef.run(resolvedArgs);
                } catch (runError: unknown) {
                  const runErrorMsg = getErrorMessage(runError);
                  toolResponse = JSON.stringify({ error: runErrorMsg });
                  logger.warn(
                    { iteration, toolName: resolvedName, error: runErrorMsg },
                    'Tool calling: run callback threw'
                  );
                }
              }

              const durationMs = Date.now() - iterationStart;
              logger.info(
                {
                  iteration,
                  toolName: resolvedName,
                  toolArgs: resolvedArgs,
                  toolResponseTruncated:
                    toolResponse.length > 200 ? toolResponse.slice(0, 200) + '...' : toolResponse,
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
              await auditContext.error({ error: 'Empty response from model' });
              trackUsage(aggregatedUsage, false, 'Empty response from model');
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

            await auditContext.success({
              response: finalText,
              inputTokens: aggregatedUsage.inputTokens,
              outputTokens: aggregatedUsage.outputTokens,
            });
            trackUsage(aggregatedUsage, true);

            return ok({
              content: finalText,
              toolCallsMade: totalToolCalls,
              iterationCount: iteration,
              usage: aggregatedUsage,
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
          await auditContext.success({
            response: lastText,
            inputTokens: aggregatedUsage.inputTokens,
            outputTokens: aggregatedUsage.outputTokens,
          });
          trackUsage(aggregatedUsage, true);

          return ok({
            content: lastText,
            toolCallsMade: totalToolCalls,
            iterationCount: iteration,
            usage: aggregatedUsage,
          });
        }

        await auditContext.error({
          error: 'Tool calling loop exceeded maxIterations',
        });
        trackUsage(aggregatedUsage, false, 'Tool calling loop exceeded maxIterations');
        return err({
          code: 'API_ERROR',
          message: 'Tool calling loop exceeded maxIterations',
        });
      } catch (error: unknown) {
        const errorMsg = getErrorMessage(error);
        await auditContext.error({ error: errorMsg });
        trackUsage(aggregatedUsage, false, errorMsg);
        return err(mapGeminiError(error));
      }
    },
  };
}

function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd,
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
