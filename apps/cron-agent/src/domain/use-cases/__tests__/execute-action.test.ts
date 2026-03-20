import { describe, it, expect } from 'vitest';
import { executeAction } from '../execute-action.js';
import type { ToolRegistry } from '../../ports/tool-registry.js';
import type { ToolCallingClient, ToolDefinition } from '@intexuraos/llm-contract';
import { ok, err } from '@intexuraos/common-core';

function createTestLogger(): never {
  return {
    info: () => { /* noop */ },
    warn: () => { /* noop */ },
    error: () => { /* noop */ },
    debug: () => { /* noop */ },
    child: () => createTestLogger(),
  } as never;
}

function createFakeToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  return {
    getToolsForService: async (): Promise<ToolDefinition[]> => tools,
    getToolsForServices: async (): Promise<ToolDefinition[]> => tools,
    listServiceTools: async (): Promise<{
      key: string;
      name: string;
      tools: { name: string; description: string; parameters: Record<string, unknown> }[];
    }[]> => [
      {
        key: 'code-agent',
        name: 'Code Agent',
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ],
    refreshAll: async (): Promise<void> => { /* noop */ },
  };
}

function createFakeToolCallingClient(response: string): ToolCallingClient {
  return {
    run: async () =>
      ok({
        content: response,
        toolCallsMade: 1,
        iterationCount: 2,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      }),
  };
}

function createFailingToolCallingClient(): ToolCallingClient {
  return {
    run: async () => err({ code: 'API_ERROR' as const, message: 'Tool calling failed' }),
  };
}

describe('executeAction', () => {
  const testTool: ToolDefinition = {
    name: 'code_agent__getRunningTasks',
    description: 'Get running tasks',
    parameters: { type: 'object', properties: {} },
    run: async () => '{"tasks": []}',
  };

  it('executes action successfully with tool calls', async () => {
    const result = await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: createFakeToolRegistry([testTool]),
        toolCallingClient: createFakeToolCallingClient('Task completed successfully'),
      },
      { services: ['code-agent'], instruction: 'check running tasks', preferredTools: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe('success');
    expect(result.value.agentResponse).toBe('Task completed successfully');
    expect(result.value.tokenUsage.inputTokens).toBe(100);
  });

  it('returns error when no tools available', async () => {
    const result = await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: createFakeToolRegistry([]),
        toolCallingClient: createFakeToolCallingClient('done'),
      },
      { services: ['unknown-service'], instruction: 'do something', preferredTools: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNKNOWN_SERVICE');
  });

  it('returns error when tool calling client fails', async () => {
    const result = await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: createFakeToolRegistry([testTool]),
        toolCallingClient: createFailingToolCallingClient(),
      },
      { services: ['code-agent'], instruction: 'check tasks', preferredTools: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
  });

  it('tracks tool call logs including duration for successful tool calls', async () => {
    const trackedTool: ToolDefinition = {
      name: 'code_agent__listTasks',
      description: 'List tasks',
      parameters: { type: 'object', properties: {} },
      run: async () => '{"result": "done"}',
    };

    // Create a client that actually calls the instrumented tools
    const toolCallingClient: ToolCallingClient = {
      run: async (opts) => {
        // Simulate calling the first tool
        const tool = opts.tools[0];
        if (tool !== undefined) {
          await tool.run({ query: 'test' });
        }
        return ok({
          content: 'Completed',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75, costUsd: 0.0005 },
        });
      },
    };

    const result = await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: createFakeToolRegistry([trackedTool]),
        toolCallingClient,
      },
      { services: ['code-agent'], instruction: 'list tasks', preferredTools: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toolCalls.length).toBe(1);
    expect(result.value.toolCalls[0]?.toolName).toBe('code_agent__listTasks');
    expect(result.value.toolCalls[0]?.args).toEqual({ query: 'test' });
    expect(result.value.toolCalls[0]?.result).toBe('{"result": "done"}');
    expect(typeof result.value.toolCalls[0]?.durationMs).toBe('number');
  });

  it('tracks tool call logs when tool throws an error', async () => {
    const failingTool: ToolDefinition = {
      name: 'code_agent__failingTool',
      description: 'A tool that fails',
      parameters: { type: 'object', properties: {} },
      run: async (): Promise<never> => {
        throw new Error('Tool execution error');
      },
    };

    // Create a client that calls the failing tool and catches the error
    const toolCallingClient: ToolCallingClient = {
      run: async (opts) => {
        const tool = opts.tools[0];
        if (tool !== undefined) {
          try {
            await tool.run({});
          } catch {
            // Tool error caught by the agent
          }
        }
        return ok({
          content: 'Handled error',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75, costUsd: 0.0005 },
        });
      },
    };

    const result = await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: createFakeToolRegistry([failingTool]),
        toolCallingClient,
      },
      { services: ['code-agent'], instruction: 'do something', preferredTools: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toolCalls.length).toBe(1);
    expect(result.value.toolCalls[0]?.toolName).toBe('code_agent__failingTool');
    expect(result.value.toolCalls[0]?.result).toContain('Tool execution error');
  });

  it('invokes onExhausted callback when provided', async () => {
    let onExhaustedCalled = false;
    const toolCallingClient: ToolCallingClient = {
      run: async (opts) => {
        // Simulate calling onExhausted
        if (opts.onExhausted !== undefined) {
          const exhaustedMsg = opts.onExhausted({ iterationCount: 10, toolCallsMade: 5 });
          onExhaustedCalled = true;
          expect(typeof exhaustedMsg).toBe('string');
        }
        return ok({
          content: 'Done',
          toolCallsMade: 0,
          iterationCount: 10,
          usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75, costUsd: 0.0005 },
        });
      },
    };

    const result = await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: createFakeToolRegistry([testTool]),
        toolCallingClient,
      },
      { services: ['code-agent'], instruction: 'exhaust iterations', preferredTools: [] },
    );
    expect(result.ok).toBe(true);
    expect(onExhaustedCalled).toBe(true);
  });

  it('maps service keys to names using listServiceTools', async () => {
    const registry: ToolRegistry = {
      getToolsForService: async () => [testTool],
      getToolsForServices: async () => [testTool],
      listServiceTools: async () => [
        {
          key: 'code-agent',
          name: 'My Code Agent',
          tools: [{
            name: testTool.name,
            description: testTool.description,
            parameters: testTool.parameters,
          }],
        },
      ],
      refreshAll: async () => { /* noop */ },
    };

    let capturedPrompt = '';
    const toolCallingClient: ToolCallingClient = {
      run: async (opts) => {
        capturedPrompt = opts.systemPrompt;
        return ok({
          content: 'Done',
          toolCallsMade: 0,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };

    await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: registry,
        toolCallingClient,
      },
      { services: ['code-agent'], instruction: 'test', preferredTools: [] },
    );
    expect(capturedPrompt).toContain('My Code Agent');
  });

  it('biases preferred tools in prompt and tool order', async () => {
    const preferredTool: ToolDefinition = {
      name: 'code_agent__preferredTool',
      description: 'Preferred tool',
      parameters: { type: 'object', properties: {} },
      run: async () => 'preferred',
    };
    const fallbackTool: ToolDefinition = {
      name: 'code_agent__fallbackTool',
      description: 'Fallback tool',
      parameters: { type: 'object', properties: {} },
      run: async () => 'fallback',
    };

    let capturedPrompt = '';
    let orderedToolNames: string[] = [];
    const toolCallingClient: ToolCallingClient = {
      run: async (opts) => {
        capturedPrompt = opts.systemPrompt;
        orderedToolNames = opts.tools.map((tool) => tool.name);
        return ok({
          content: 'Done',
          toolCallsMade: 0,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };

    const result = await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: createFakeToolRegistry([fallbackTool, preferredTool]),
        toolCallingClient,
      },
      {
        services: ['code-agent'],
        instruction: 'test',
        preferredTools: ['code_agent__preferredTool'],
      },
    );

    expect(result.ok).toBe(true);
    expect(orderedToolNames).toEqual([
      'code_agent__preferredTool',
      'code_agent__fallbackTool',
    ]);
    expect(capturedPrompt).toContain('Preferred tools');
    expect(capturedPrompt).toContain('code_agent__preferredTool');
  });

  it('falls back to service key when no matching service info found', async () => {
    const registry: ToolRegistry = {
      getToolsForService: async () => [testTool],
      getToolsForServices: async () => [testTool],
      listServiceTools: async () => [],
      refreshAll: async () => { /* noop */ },
    };

    let capturedPrompt = '';
    const toolCallingClient: ToolCallingClient = {
      run: async (opts) => {
        capturedPrompt = opts.systemPrompt;
        return ok({
          content: 'Done',
          toolCallsMade: 0,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };

    await executeAction(
      {
        logger: createTestLogger(),
        toolRegistry: registry,
        toolCallingClient,
      },
      { services: ['code-agent'], instruction: 'test', preferredTools: [] },
    );
    expect(capturedPrompt).toContain('code-agent');
  });
});
