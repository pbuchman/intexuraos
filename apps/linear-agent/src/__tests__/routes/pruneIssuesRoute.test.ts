import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { ok, err } from '@intexuraos/common-core';
import type { FastifyInstance } from 'fastify';

// Set up internal auth token for testing
process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';

function createFakeServices(): ServiceContainer {
  return {
    connectionRepository: {
      getAllConnectedUserIds: vi.fn().mockResolvedValue(ok(['user-1'])),
      getFullConnection: vi.fn().mockResolvedValue(
        ok({ userId: 'user-1', apiKey: 'key', teamId: 't', teamName: 'T', webhookSecret: null, connected: true, createdAt: '', updatedAt: '' })
      ),
      save: vi.fn(),
      getConnection: vi.fn(),
      getApiKey: vi.fn(),
      isConnected: vi.fn(),
      disconnect: vi.fn(),
      findUserIdsByTeamId: vi.fn(),
      findWebhookSecretByTeamId: vi.fn(),
      updateWebhookSecret: vi.fn(),
    },
    linearApiClient: {
      validateAndGetTeams: vi.fn(),
      createIssue: vi.fn(),
      listIssues: vi.fn(),
      getIssue: vi.fn(),
      getIssueByIdentifier: vi.fn(),
      updateIssueState: vi.fn(),
      updateIssue: vi.fn(),
      createComment: vi.fn(),
      listIssueLabels: vi.fn(),
      getWorkflowStates: vi.fn(),
      deleteIssue: vi.fn().mockResolvedValue(ok(undefined)),
    },
    extractionService: { extractIssue: vi.fn() },
    failedIssueRepository: { create: vi.fn(), listByUser: vi.fn(), getById: vi.fn(), update: vi.fn(), delete: vi.fn() },
    processedActionRepository: { getByActionId: vi.fn(), create: vi.fn() },
    issueRepository: {
      save: vi.fn(),
      findById: vi.fn(),
      findByIdentifier: vi.fn(),
      findByIdentifiers: vi.fn(),
      listByUserId: vi.fn().mockResolvedValue(ok([])),
      deleteById: vi.fn().mockResolvedValue(ok(undefined)),
      findUserIdsByIssueId: vi.fn(),
    },
    commentRepository: {
      save: vi.fn(), findById: vi.fn(), listByIssueId: vi.fn(),
      countByIssueId: vi.fn(), getCommentSummaries: vi.fn(), deleteById: vi.fn(),
    },
    userServiceClient: { getLlmClient: vi.fn(), getLlmClientDirect: vi.fn() } as any,
    codeAgentClient: { triggerCodeTask: vi.fn() },
    issuePruningClassifier: {
      classifyCandidates: vi.fn().mockResolvedValue(ok([])),
    },
  } as unknown as ServiceContainer;
}

describe('POST /internal/linear/prune-issues', () => {
  let app: FastifyInstance;
  let services: ServiceContainer;

  beforeEach(async () => {
    services = createFakeServices();
    setServices(services);
    app = await buildServer();
  });

  afterEach(async () => {
    resetServices();
    vi.clearAllMocks();
    await app.close();
  });

  it('returns 200 with skipped stats when below threshold', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/linear/prune-issues',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.skipped).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/linear/prune-issues',
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts OIDC Bearer token auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/linear/prune-issues',
      headers: { authorization: 'Bearer oidc-token-from-scheduler' },
    });

    expect(response.statusCode).toBe(200);
  });
});
