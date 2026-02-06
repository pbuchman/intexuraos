#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer } from 'http';
import { createGLMClient } from './api/glm-client.js';
import { collector } from './metrics/collector.js';
import { generateCode, generateCodeSchema } from './tools/generate-code.js';
import { generateTests, generateTestsSchema } from './tools/generate-tests.js';
import { logger } from './utils/logger.js';
import { formatDuration } from './utils/format.js';

const DEV_PORT = 3100;
const isDevMode = process.argv.includes('--dev');

const server = new McpServer({
  name: 'glm-coder',
  version: '0.1.0',
});

const cwd = process.cwd();

logger.info('Starting MCP server', { cwd, devMode: isDevMode });

let glmClient: ReturnType<typeof createGLMClient> | null = null;

function getClient(): ReturnType<typeof createGLMClient> {
  if (!glmClient) {
    glmClient = createGLMClient();
    logger.info('GLM client initialized');
  }
  return glmClient;
}

server.tool(
  'generate_code',
  'Generate TypeScript code using GLM-4.7. Reads project patterns automatically. Returns generated code with validation status.',
  generateCodeSchema.shape,
  async (params) => {
    logger.info('Tool invoked: generate_code', {
      task: params.task,
      targetFile: params.targetFile,
    });
    const startTime = Date.now();

    const validatedParams = generateCodeSchema.parse(params);

    const result = await generateCode(validatedParams, getClient(), collector, cwd);

    const latencyMs = Date.now() - startTime;
    logger.info('Tool complete: generate_code', {
      success: result.success,
      attempts: result.attempts,
      latency: formatDuration(latencyMs),
    });

    const statusLine = result.success
      ? `// Generated successfully in ${result.attempts} attempt(s)\n\n`
      : '';

    return {
      content: [
        {
          type: 'text' as const,
          text: statusLine + result.content,
        },
      ],
    };
  }
);

server.tool(
  'generate_tests',
  'Generate vitest tests for a TypeScript source file using GLM-4.7. Automatically infers test file location and extracts source context.',
  generateTestsSchema.shape,
  async (params) => {
    logger.info('Tool invoked: generate_tests', { sourceFile: params.sourceFile });
    const startTime = Date.now();

    const validatedParams = generateTestsSchema.parse(params);

    const result = await generateTests(validatedParams, getClient(), collector, cwd);

    const latencyMs = Date.now() - startTime;
    logger.info('Tool complete: generate_tests', {
      success: result.success,
      targetFile: result.targetFile,
      latency: formatDuration(latencyMs),
    });

    const header = result.success
      ? `// Tests generated successfully for: ${validatedParams.sourceFile}\n// Target file: ${result.targetFile}\n\n`
      : `// Test generation had issues\n// Target file: ${result.targetFile}\n\n`;

    return {
      content: [
        {
          type: 'text' as const,
          text: header + result.content,
        },
      ],
    };
  }
);

server.tool('glm_stats', 'Show GLM coder usage statistics and metrics', {}, async () => {
  logger.info('Tool invoked: glm_stats');

  const { loadMetrics, loadPostHocEvents } = await import('./metrics/collector.js');

  const metrics = loadMetrics();
  const postHoc = loadPostHocEvents();

  if (metrics.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No metrics recorded yet.' }],
    };
  }

  const total = metrics.length;
  const successful = metrics.filter((m) => m.finalSuccess).length;
  const firstAttemptSuccess = metrics.filter((m) => m.attempts[0]?.success).length;
  const avgAttempts = metrics.reduce((sum, m) => sum + m.attempts.length, 0) / total;
  const avgLatency = metrics.reduce((sum, m) => sum + m.totalLatencyMs, 0) / total;

  const editedCallIds = new Set(postHoc.map((e) => e.callId));
  const manualEditsCount = metrics.filter((m) => editedCallIds.has(m.id)).length;

  const report = `
GLM Coder Metrics Report
========================
Period: ${metrics[0]?.timestamp.slice(0, 10)} → ${metrics[total - 1]?.timestamp.slice(0, 10)}
Total Calls: ${total}

SUCCESS RATES
─────────────
Final Success Rate:     ${((successful / total) * 100).toFixed(1)}%
First-Attempt Success:  ${((firstAttemptSuccess / total) * 100).toFixed(1)}%
Average Attempts:       ${avgAttempts.toFixed(2)}
Manual Edits Required:  ${((manualEditsCount / total) * 100).toFixed(1)}%

PERFORMANCE
───────────
Average Latency: ${(avgLatency / 1000).toFixed(2)}s

RECENT CALLS
────────────
${metrics
  .slice(-5)
  .map(
    (m) =>
      `${m.timestamp.slice(0, 16)} | ${m.finalSuccess ? '✓' : '✗'} | ${m.attempts.length} attempts | ${m.taskDescription.slice(0, 40)}...`
  )
  .join('\n')}
`.trim();

  return {
    content: [{ type: 'text' as const, text: report }],
  };
});

async function main(): Promise<void> {
  if (isDevMode) {
    // Dev mode: HTTP server for hot-reload development
    logger.info('Starting in DEV mode', { port: DEV_PORT });

    let currentTransport: SSEServerTransport | null = null;

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${DEV_PORT}`);
      logger.info('HTTP request', { method: req.method, path: url.pathname });

      if (url.pathname === '/sse') {
        // Close previous connection before accepting new one (proxy reconnect)
        if (currentTransport) {
          logger.info('Closing previous SSE connection');
          await server.close();
        }
        logger.info('SSE connection established');
        currentTransport = new SSEServerTransport('/message', res);
        await server.connect(currentTransport);
      } else if (url.pathname === '/message' && req.method === 'POST') {
        // Route POST messages to the current transport
        if (currentTransport) {
          await currentTransport.handlePostMessage(req, res);
        } else {
          res.writeHead(503);
          res.end('No active SSE connection');
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`GLM Coder MCP Server (dev mode)\nConnect via SSE at /sse`);
      }
    });

    httpServer.listen(DEV_PORT, () => {
      logger.info('Dev server listening', { url: `http://localhost:${DEV_PORT}` });
      logger.info('Use proxy to connect from Claude Code');
    });
  } else {
    // Production mode: stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server connected and ready');
  }
}

main().catch((error) => {
  logger.error('Fatal error', { error: String(error) });
  process.exit(1);
});
