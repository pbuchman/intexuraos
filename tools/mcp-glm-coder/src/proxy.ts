#!/usr/bin/env node
/**
 * MCP Proxy for development.
 *
 * Claude Code spawns this (stdio) and it forwards to the dev server (HTTP/SSE).
 * This allows hot-reload: edit code → tsx watch restarts → proxy reconnects.
 *
 * Usage:
 *   Terminal 1: pnpm dev:server (runs server with --dev flag on port 3100)
 *   .mcp.json: points to this proxy
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createLogger } from './utils/logger.js';
import { formatDuration } from './utils/format.js';

const DEV_SERVER_URL = process.env['GLM_DEV_SERVER'] ?? 'http://localhost:3100';
const logger = createLogger('glm-proxy');

// Schemas must match the dev server exactly
const generateCodeSchema = z.object({
  task: z.string().describe('What code to implement'),
  contextFiles: z.array(z.string()).optional().describe('Paths to files that provide context'),
  targetFile: z.string().optional().describe('Where this code will live'),
  style: z.enum(['minimal', 'documented', 'defensive']).optional().describe('Code style'),
});

const generateTestsSchema = z.object({
  sourceFile: z.string().describe('Path to the file to test'),
  testStyle: z.enum(['unit', 'integration']).optional().describe('Type of tests to generate'),
  coverage: z.enum(['full', 'happy-path']).optional().describe('Coverage level'),
});

const CONNECTION_TIMEOUT_MS = 5000;

async function main(): Promise<void> {
  logger.info('Starting proxy', { devServer: DEV_SERVER_URL });

  const proxyServer = new McpServer({
    name: 'glm-coder-proxy',
    version: '0.1.0',
  });

  // Dev server client - lazy initialized, reconnects on failure
  let devClient: Client | null = null;

  async function connectToDevServer(): Promise<Client> {
    logger.info('Connecting to dev server', { url: `${DEV_SERVER_URL}/sse` });
    const client = new Client({
      name: 'glm-proxy-client',
      version: '0.1.0',
    });

    const transport = new SSEClientTransport(new URL('/sse', DEV_SERVER_URL));

    // Add timeout to prevent hanging forever
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), CONNECTION_TIMEOUT_MS)
    );

    await Promise.race([connectPromise, timeoutPromise]);
    logger.info('Connected to dev server');
    return client;
  }

  async function getDevClient(): Promise<Client> {
    if (devClient === null) {
      devClient = await connectToDevServer();
    }
    return devClient;
  }

  type ToolResult = { content: Array<{ type: 'text'; text: string }> };

  function serverUnavailableResponse(toolName: string): ToolResult {
    return {
      content: [
        {
          type: 'text' as const,
          text: `⚠️ GLM Dev Server Unavailable

The dev server is not running at ${DEV_SERVER_URL}.

To start it, run in a separate terminal:
  cd tools/mcp-glm-coder && pnpm dev:server

Tool called: ${toolName}

Alternative: Switch .mcp.json to use the direct server (no hot-reload):
  "args": ["tsx", "tools/mcp-glm-coder/src/index.ts"]`,
        },
      ],
    };
  }

  async function callWithReconnect<T extends ToolResult>(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<T> {
    try {
      const client = await getDevClient();
      const result = await client.callTool({ name: toolName, arguments: args });
      return result as T;
    } catch (error) {
      logger.warn('Call failed, reconnecting', { error: String(error) });
      devClient = null;

      // One retry attempt
      try {
        const client = await getDevClient();
        const result = await client.callTool({ name: toolName, arguments: args });
        return result as T;
      } catch (retryError) {
        logger.error('Retry failed, server unavailable', { error: String(retryError) });
        return serverUnavailableResponse(toolName) as T;
      }
    }
  }

  // Register tools that forward to dev server
  proxyServer.tool(
    'generate_code',
    'Generate TypeScript code using GLM-4.7 (proxied to dev server)',
    generateCodeSchema.shape,
    async (params) => {
      logger.info('Tool call: generate_code', { task: params.task, targetFile: params.targetFile });
      const startTime = Date.now();
      const result = await callWithReconnect<{ content: Array<{ type: 'text'; text: string }> }>(
        'generate_code',
        params
      );
      const latencyMs = Date.now() - startTime;
      logger.info('Tool complete: generate_code', {
        latency: formatDuration(latencyMs),
        hasContent: !!result.content,
      });
      return {
        content: result.content ?? [{ type: 'text' as const, text: 'No response from dev server' }],
      };
    }
  );

  proxyServer.tool(
    'generate_tests',
    'Generate vitest tests (proxied to dev server)',
    generateTestsSchema.shape,
    async (params) => {
      logger.info('Tool call: generate_tests', { sourceFile: params.sourceFile });
      const startTime = Date.now();
      const result = await callWithReconnect<{ content: Array<{ type: 'text'; text: string }> }>(
        'generate_tests',
        params
      );
      const latencyMs = Date.now() - startTime;
      logger.info('Tool complete: generate_tests', {
        latency: formatDuration(latencyMs),
        hasContent: !!result.content,
      });
      return {
        content: result.content ?? [{ type: 'text' as const, text: 'No response from dev server' }],
      };
    }
  );

  proxyServer.tool(
    'glm_stats',
    'Show GLM coder usage statistics (proxied to dev server)',
    {},
    async () => {
      logger.info('Tool call: glm_stats');
      const startTime = Date.now();
      const result = await callWithReconnect<{ content: Array<{ type: 'text'; text: string }> }>(
        'glm_stats',
        {}
      );
      const latencyMs = Date.now() - startTime;
      logger.info('Tool complete: glm_stats', { latency: formatDuration(latencyMs) });
      return {
        content: result.content ?? [{ type: 'text' as const, text: 'No response from dev server' }],
      };
    }
  );

  // Connect to Claude Code via stdio
  const transport = new StdioServerTransport();
  await proxyServer.connect(transport);
  logger.info('Proxy ready', { forwardingTo: DEV_SERVER_URL });
}

main().catch((error) => {
  logger.error('Fatal error', { error: String(error) });
  process.exit(1);
});
