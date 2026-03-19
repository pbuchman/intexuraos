import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { ToolCallingClient, ToolDefinition } from '@intexuraos/llm-contract';
import type { ToolRegistry } from '../ports/tool-registry.js';
import type { ActionResult, ToolCallLog, ScheduleAction } from '../types.js';
import { executeActionPrompt } from '../../prompts/execute-action-prompt.js';

export interface ActionError {
  code: 'UNKNOWN_SERVICE' | 'EXECUTION_FAILED' | 'MAX_ITERATIONS';
  message: string;
}

export interface ExecuteActionDeps {
  logger: Logger;
  toolRegistry: ToolRegistry;
  toolCallingClient: ToolCallingClient;
}

export async function executeAction(
  deps: ExecuteActionDeps,
  action: ScheduleAction,
): Promise<Result<ActionResult, ActionError>> {
  const { logger, toolRegistry, toolCallingClient } = deps;

  // Get tools for the specified services
  const tools = await toolRegistry.getToolsForServices(action.services);
  if (tools.length === 0) {
    return err({
      code: 'UNKNOWN_SERVICE',
      message: `No tools available for services: ${action.services.join(', ')}`,
    });
  }

  // Get service names for the prompt
  const serviceInfos = await toolRegistry.listServiceTools();
  const serviceNames = action.services.map((key) => {
    const info = serviceInfos.find((s) => s.key === key);
    return info?.name ?? key;
  });

  const systemPrompt = executeActionPrompt.build({
    instruction: action.instruction,
    serviceNames,
  });

  // Wrap tools to track call logs
  const toolCallLogs: ToolCallLog[] = [];
  const instrumentedTools: ToolDefinition[] = tools.map((tool) => ({
    ...tool,
    run: async (args: Record<string, unknown>): Promise<string> => {
      const start = Date.now();
      try {
        const toolResult = await tool.run(args);
        const durationMs = Date.now() - start;
        toolCallLogs.push({
          toolName: tool.name,
          args,
          result: toolResult,
          durationMs,
        });
        return toolResult;
      } catch (error: unknown) {
        const durationMs = Date.now() - start;
        const errorMsg = String(error);
        toolCallLogs.push({
          toolName: tool.name,
          args,
          result: JSON.stringify({ error: errorMsg }),
          durationMs,
        });
        throw error;
      }
    },
  }));

  const result = await toolCallingClient.run({
    systemPrompt,
    messages: [{ role: 'user', content: action.instruction }],
    tools: instrumentedTools,
    maxIterations: 10,
    onExhausted: () => 'Please provide a final summary of what you have done so far.',
    repairIterations: 1,
  });

  if (!result.ok) {
    logger.error({ error: result.error }, 'Tool calling failed');
    return err({
      code: 'EXECUTION_FAILED',
      message: result.error.message,
    });
  }

  const { content, usage } = result.value;

  return ok({
    outcome: 'success',
    agentResponse: content,
    toolCalls: toolCallLogs,
    tokenUsage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalCost: usage.costUsd,
    },
  });
}
