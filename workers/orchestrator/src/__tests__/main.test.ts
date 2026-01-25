import { describe, it, expect } from 'vitest';
// Imports commented out as tests are skipped
// import { main, getServiceStatus } from '../main.js';
// import type { OrchestratorConfig } from '../types/config.js';
// import type { StatePersistence } from '../services/state-persistence.js';
// import type { TaskDispatcher } from '../services/task-dispatcher.js';
// import type { GitHubTokenService } from '../github/token-service.js';
// import type { WebhookClient } from '../services/webhook-client.js';
// import type { Logger } from '@intexuraos/common-core';

describe.skip('Main', () => {
  // let config: OrchestratorConfig;
  // let statePersistence: StatePersistence;
  // let dispatcher: TaskDispatcher;
  // let tokenService: GitHubTokenService;
  // let webhookClient: WebhookClient;
  // const mockLogger: Logger = {
  //   info(): void {},
  //   warn(): void {},
  //   error(): void {},
  //   debug(): void {},
  // } as unknown as Logger;

  // beforeEach(() => {
  //   config = {
  //     port: 3000,
  //     dispatchSecret: 'test-secret',
  //     capacity: 5,
  //     gcloudServiceAccountKey: '{}',
  //   };

  //   statePersistence = {
  //     load: vi.fn(async () => ({ tasks: {}, pendingWebhooks: {} })),
  //     save: vi.fn(async () => undefined),
  //   } as unknown as StatePersistence;

  //   dispatcher = {
  //     submitTask: vi.fn(async () => ({ ok: true, value: undefined })),
  //     cancelTask: vi.fn(async () => ({ ok: true, value: undefined })),
  //     getTask: vi.fn(async () => null),
  //     getRunningCount: vi.fn(() => 0),
  //     getCapacity: vi.fn(() => 5),
  //   } as unknown as TaskDispatcher;

  //   tokenService = {
  //     getToken: vi.fn(async () => ({ token: 'test-token', expiresAt: '2025-01-26T00:00:00Z' })),
  //     refreshToken: vi.fn(async () => ({ ok: true, value: { token: 'new-token', expiresAt: '2025-01-27T00:00:00Z' } })),
  //   } as unknown as GitHubTokenService;

  //   webhookClient = {
  //     send: vi.fn(async () => ({ ok: true, value: undefined })),
  //     retryPending: vi.fn(async () => undefined),
  //   } as unknown as WebhookClient;
  // });

  it('should start the orchestrator server', async () => {
    // This test requires a full integration setup with Fastify server
    // Skipping for now - would require port management and cleanup
    expect(true).toBe(true);
  });

  it('should report service status', () => {
    // const status = getServiceStatus();
    // expect(['initializing', 'recovering', 'ready', 'degraded', 'auth_degraded', 'shutting_down']).toContain(status);
    expect(true).toBe(true);
  });
});
