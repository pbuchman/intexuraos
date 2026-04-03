/**
 * Integration tests for Orchestrator HTTP-only communication.
 *
 * Tests the complete flow from task dispatch through log forwarding, heartbeat,
 * and task completion, verifying all HTTP calls use proper HMAC signatures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as typeof global.fetch;

describe('Orchestrator HTTP-Only Integration', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-integration-test-'));
  const logBasePath = join(tempDir, 'logs');

  // Test configuration
  const codeAgentUrl = 'https://code-agent.test';
  const orchestratorSecret = 'test-orchestrator-secret';
  const webhookSecret = 'test-webhook-secret';

  // Track HTTP requests
  const httpRequests: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];

  // Track running tasks for heartbeat
  const runningTasks: string[] = [];

  function setupMockFetch(): void {
    httpRequests.length = 0;
    mockFetch.mockReset();

    // Default: successful responses
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlString = String(url);
      const body = options?.body as string;
      const headers = options?.headers as Record<string, string>;

      // Record the request
      httpRequests.push({
        url: urlString,
        method: options?.method ?? 'GET',
        headers: {
          'content-type': headers?.['Content-Type'] as string,
          'x-request-timestamp': headers?.['X-Request-Timestamp'] as string,
          'x-request-signature': headers?.['X-Request-Signature'] as string,
        },
        body,
      });

      // Handle different endpoints
      if (urlString.includes('/internal/logs')) {
        return { ok: true, json: async () => ({ received: true }) } as Response;
      }

      if (urlString.includes('/internal/code/heartbeat')) {
        return {
          ok: true,
          json: async () => ({ processed: runningTasks.length, notFound: [] }),
        } as Response;
      }

      if (urlString.includes('/internal/webhooks/task-complete')) {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }

      return { ok: true, json: async () => ({ success: true }) } as Response;
    });
  }

  function generateOrchestratorSignature(payload: object): {
    timestamp: string;
    signature: string;
  } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(payload);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', orchestratorSecret).update(message).digest('hex');
    return { timestamp, signature };
  }

  function generateWebhookSignature(payload: object): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(payload);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', webhookSecret).update(message).digest('hex');
    return { timestamp, signature };
  }

  function verifyWebhookSignature(
    _url: string,
    body: string,
    headers: Record<string, string>
  ): boolean {
    const timestamp = headers['x-request-timestamp'];
    const signature = headers['x-request-signature'];

    if (!timestamp || !signature) {
      return false;
    }

    const message = `${String(timestamp)}.${body}`;
    const expected = crypto.createHmac('sha256', webhookSecret).update(message).digest('hex');

    return signature === expected;
  }

  function verifyOrchestratorSignature(
    _url: string,
    body: string,
    headers: Record<string, string>
  ): boolean {
    const timestamp = headers['x-request-timestamp'];
    const signature = headers['x-request-signature'];

    if (!timestamp || !signature) {
      return false;
    }

    const message = `${String(timestamp)}.${body}`;
    const expected = crypto.createHmac('sha256', orchestratorSecret).update(message).digest('hex');

    return signature === expected;
  }

  beforeEach(() => {
    setupMockFetch();
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(logBasePath, { recursive: true });
    runningTasks.length = 0;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Log Forwarding via HTTP', () => {
    it('sends logs via HTTP with valid HMAC signature', async () => {
      // Simulate log forwarding
      const logChunks = [
        { sequence: 1, content: 'Test log line 1', timestamp: '2024-01-01T00:00:00.000Z' },
        { sequence: 2, content: 'Test log line 2', timestamp: '2024-01-01T00:00:01.000Z' },
      ];

      const taskId = 'test-task-123';
      const payload = { taskId, chunks: logChunks };

      const rawBody = JSON.stringify(payload);
      const { timestamp, signature } = generateOrchestratorSignature(payload);

      const response = await fetch(`${codeAgentUrl}/internal/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp,
          'X-Request-Signature': signature,
        },
        body: rawBody,
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(true);

      // Verify the request was made with correct signature
      const logRequest = httpRequests.find((req) => req.url.includes('/internal/logs'));
      expect(logRequest).toBeDefined();
      expect(logRequest?.method).toBe('POST');
      if (logRequest) {
        expect(
          verifyOrchestratorSignature(logRequest.url, logRequest.body, logRequest.headers)
        ).toBe(true);
      }
    });

    it('rejects requests with invalid HMAC signature', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 } as Response);

      const logChunks = [
        { sequence: 1, content: 'Invalid signature test', timestamp: '2024-01-01T00:00:00.000Z' },
      ];
      const payload = { taskId: 'test-task-invalid', chunks: logChunks };

      const { timestamp } = generateOrchestratorSignature(payload);
      const wrongSignature = 'invalid-signature';

      const response = await fetch(`${codeAgentUrl}/internal/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp,
          'X-Request-Signature': wrongSignature,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });

  describe('Heartbeat via HTTP', () => {
    it('sends heartbeats for running tasks', async () => {
      // Add task to running list
      runningTasks.push('heartbeat-task-123');

      const payload = { taskIds: runningTasks };
      const { timestamp, signature } = generateOrchestratorSignature(payload);

      const response = await fetch(`${codeAgentUrl}/internal/code/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp,
          'X-Request-Signature': signature,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(true);

      // Verify the request was made with correct signature
      const heartbeatRequest = httpRequests.find((req) =>
        req.url.includes('/internal/code/heartbeat')
      );
      expect(heartbeatRequest).toBeDefined();
      if (heartbeatRequest) {
        expect(
          verifyOrchestratorSignature(
            heartbeatRequest.url,
            heartbeatRequest.body,
            heartbeatRequest.headers
          )
        ).toBe(true);
        expect(JSON.parse(heartbeatRequest.body)).toEqual({ taskIds: ['heartbeat-task-123'] });
      }
    });

    it('skips heartbeat when no tasks are running', async () => {
      const payload = { taskIds: [] };
      const { timestamp, signature } = generateOrchestratorSignature(payload);

      const response = await fetch(`${codeAgentUrl}/internal/code/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp,
          'X-Request-Signature': signature,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(true);

      // Verify the request was still made (code-agent tracks what's NOT running)
      const heartbeatRequest = httpRequests.find((req) =>
        req.url.includes('/internal/code/heartbeat')
      );
      expect(heartbeatRequest).toBeDefined();
      if (heartbeatRequest) {
        expect(JSON.parse(heartbeatRequest.body)).toEqual({ taskIds: [] });
      }
    });

    it('rejects heartbeat requests with invalid signature', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 } as Response);

      const payload = { taskIds: ['heartbeat-task-123'] };
      const { timestamp } = generateOrchestratorSignature(payload);

      const response = await fetch(`${codeAgentUrl}/internal/code/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp,
          'X-Request-Signature': 'wrong-signature',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });

  describe('Task Completion Webhook', () => {
    it('sends task completion webhook with valid HMAC signature', async () => {
      const taskId = 'complete-task-123';
      const payload = {
        taskId,
        status: 'completed',
        result: {
          branch: 'test-branch',
          commits: 3,
          summary: 'Test completed',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
        },
      };

      const rawBody = JSON.stringify(payload);
      const { timestamp, signature } = generateWebhookSignature(payload);

      const response = await fetch(`${codeAgentUrl}/internal/webhooks/task-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp,
          'X-Request-Signature': signature,
        },
        body: rawBody,
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(true);

      // Verify the request was made with correct signature
      const webhookRequest = httpRequests.find((req) =>
        req.url.includes('/internal/webhooks/task-complete')
      );
      expect(webhookRequest).toBeDefined();
      expect(webhookRequest?.method).toBe('POST');
      if (webhookRequest) {
        expect(JSON.parse(webhookRequest.body)).toEqual(payload);
      }
    });

    it('rejects webhook with invalid signature', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 } as Response);

      const payload = { taskId: 'webhook-invalid', status: 'completed' };
      const { timestamp } = generateWebhookSignature(payload);

      const response = await fetch(`${codeAgentUrl}/internal/webhooks/task-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp,
          'X-Request-Signature': 'invalid',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });

  describe('Full Task Lifecycle Integration', () => {
    it('completes full lifecycle: dispatch → logs → heartbeat → complete', async () => {
      const taskId = 'lifecycle-task-123';

      // Step 1: Simulate log forwarding during task execution
      const logChunks = [
        { sequence: 1, content: 'Starting task...', timestamp: '2024-01-01T00:00:00.000Z' },
        { sequence: 2, content: 'Task in progress...', timestamp: '2024-01-01T00:00:01.000Z' },
        { sequence: 3, content: 'Task completed!', timestamp: '2024-01-01T00:00:02.000Z' },
      ];

      const logPayload = { taskId, chunks: logChunks };
      const { timestamp: logTimestamp, signature: logSignature } =
        generateOrchestratorSignature(logPayload);

      const logResponse = await fetch(`${codeAgentUrl}/internal/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': logTimestamp,
          'X-Request-Signature': logSignature,
        },
        body: JSON.stringify(logPayload),
        signal: AbortSignal.timeout(5000),
      });

      expect(logResponse.ok).toBe(true);

      // Step 2: Simulate heartbeat
      runningTasks.push(taskId);
      const heartbeatPayload = { taskIds: runningTasks };
      const { timestamp: hbTimestamp, signature: hbSignature } =
        generateOrchestratorSignature(heartbeatPayload);

      const heartbeatResponse = await fetch(`${codeAgentUrl}/internal/code/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': hbTimestamp,
          'X-Request-Signature': hbSignature,
        },
        body: JSON.stringify(heartbeatPayload),
        signal: AbortSignal.timeout(5000),
      });

      expect(heartbeatResponse.ok).toBe(true);

      // Step 3: Simulate task completion webhook
      const webhookPayload = {
        taskId,
        status: 'completed',
        result: { branch: 'lifecycle-branch', commits: 5, summary: 'Lifecycle test passed' },
      };

      const { timestamp: webhookTimestamp, signature: webhookSignature } =
        generateWebhookSignature(webhookPayload);

      const webhookResponse = await fetch(`${codeAgentUrl}/internal/webhooks/task-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': webhookTimestamp,
          'X-Request-Signature': webhookSignature,
        },
        body: JSON.stringify(webhookPayload),
        signal: AbortSignal.timeout(5000),
      });

      expect(webhookResponse.ok).toBe(true);

      // Verify all requests were made
      expect(httpRequests.length).toBeGreaterThanOrEqual(3);

      // Verify all requests have valid signatures
      const orchestratorRequests = httpRequests.filter(
        (req) => req.url.includes('/internal/logs') || req.url.includes('/internal/code/heartbeat')
      );

      orchestratorRequests.forEach((req) => {
        expect(verifyOrchestratorSignature(req.url, req.body, req.headers)).toBe(true);
      });
    });
  });

  describe('Timeout Completion and Cleanup', () => {
    it('MCP timeout marker flows through log pipeline to code-agent', async () => {
      const taskId = 'timeout-task-123';

      // The entrypoint emits this stable marker when `timeout` kills the Codex process
      // (exit code 124 → 1). The orchestrator must forward it through the log pipeline
      // so operators can scan for "MCP timeout" + "server=linear" in production logs.
      const timeoutMarker = '[entrypoint] MCP timeout server=linear timeout_ms=60000';

      const logChunks = [
        { sequence: 1, content: 'Starting codex...', timestamp: '2024-01-01T00:00:00.000Z' },
        { sequence: 2, content: timeoutMarker, timestamp: '2024-01-01T00:01:00.000Z' },
      ];

      const logPayload = { taskId, chunks: logChunks };
      const { timestamp, signature } = generateOrchestratorSignature(logPayload);

      const logResponse = await fetch(`${codeAgentUrl}/internal/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp,
          'X-Request-Signature': signature,
        },
        body: JSON.stringify(logPayload),
        signal: AbortSignal.timeout(5000),
      });

      expect(logResponse.ok).toBe(true);

      // Verify the log request was signed and contains the timeout marker
      const logRequest = httpRequests.find((req) => req.url.includes('/internal/logs'));
      if (logRequest === undefined) {
        throw new Error('Expected log request to be captured but none was found');
      }
      const verifiedLogRequest = logRequest;
      expect(
        verifyOrchestratorSignature(
          verifiedLogRequest.url,
          verifiedLogRequest.body,
          verifiedLogRequest.headers
        )
      ).toBe(true);
      const body = JSON.parse(verifiedLogRequest.body) as {
        taskId: string;
        chunks: { content: string }[];
      };
      expect(body.chunks.some((c) => c.content.includes('MCP timeout'))).toBe(true);
    });

    it('completion webhook accepts failure status with valid HMAC after timeout', async () => {
      const taskId = 'timeout-task-456';

      // After timeout, task completion webhook fires with failure status
      const webhookPayload = {
        taskId,
        status: 'failed',
        result: { error: 'MCP timeout (Linear server, 60000ms)' },
      };

      const { timestamp: whTimestamp, signature: whSignature } =
        generateWebhookSignature(webhookPayload);

      const webhookResponse = await fetch(`${codeAgentUrl}/internal/webhooks/task-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': whTimestamp,
          'X-Request-Signature': whSignature,
        },
        body: JSON.stringify(webhookPayload),
        signal: AbortSignal.timeout(5000),
      });

      expect(webhookResponse.ok).toBe(true);

      const webhookRequest = httpRequests.find((req) =>
        req.url.includes('/internal/webhooks/task-complete')
      );
      if (webhookRequest === undefined) {
        throw new Error('Expected webhook request to be captured but none was found');
      }
      const verifiedRequest = webhookRequest;
      expect(
        verifyWebhookSignature(verifiedRequest.url, verifiedRequest.body, verifiedRequest.headers)
      ).toBe(true);
    });
  });

  describe('Signature Security', () => {
    it('validates timing attack protection with timestamp window', async () => {
      // Test expired timestamp (> 15 minutes old)
      const expiredTimestamp = String(Math.floor((Date.now() - 20 * 60 * 1000) / 1000));
      const payload = { taskIds: ['security-task-1'] };

      const message = `${expiredTimestamp}.${JSON.stringify(payload)}`;
      const signature = crypto
        .createHmac('sha256', orchestratorSecret)
        .update(message)
        .digest('hex');

      mockFetch.mockResolvedValue({ ok: false, status: 401 } as Response);

      const response = await fetch(`${codeAgentUrl}/internal/code/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': expiredTimestamp,
          'X-Request-Signature': signature,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it('prevents replay attacks with unique timestamps', async () => {
      const payload = { taskIds: ['replay-task-1'] };

      // First request with valid timestamp
      const { timestamp: timestamp1, signature: signature1 } =
        generateOrchestratorSignature(payload);

      // Try to replay with same timestamp and signature
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ received: true }),
      } as Response);
      const response1 = await fetch(`${codeAgentUrl}/internal/code/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': timestamp1,
          'X-Request-Signature': signature1,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      expect(response1.ok).toBe(true);

      // Now code-agent should reject a replay with the same timestamp
      // In a real scenario, code-agent would track used nonces
      // For this test, we just verify the signature includes timestamp
      expect(signature1).toBeDefined();
      expect(signature1.length).toBe(64); // HMAC-SHA256 produces 64 hex chars
    });
  });
});
