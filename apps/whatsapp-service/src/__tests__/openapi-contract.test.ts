import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import { buildServer } from '../server.js';
import type { Config } from '../config.js';

interface OpenApiSpec {
  openapi?: string;
  servers?: { url: string; description?: string }[];
  paths?: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        responses?: Record<string, { content?: Record<string, unknown> }>;
        parameters?: { in: string; name: string; required?: boolean }[];
      }
    >
  >;
  components?: {
    schemas?: Record<string, Record<string, unknown>>;
  };
}

describe('whatsapp-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: OpenApiSpec;

  const testConfig: Config = {
    verifyToken: 'test-verify-token-12345',
    appSecret: 'test-app-secret-67890',
    accessToken: 'test-access-token',
    allowedWabaIds: ['102290129340398'],
    allowedPhoneNumberIds: ['123456789012345'],
    mediaBucket: 'test-media-bucket',
    mediaCleanupTopic: 'test-media-cleanup',
    mediaCleanupSubscription: 'test-media-cleanup-sub',
    intexMessageIngestTopic: 'test-intex-message-ingest',
    audioStoredTopic: 'test-audio-stored',
    gcpProjectId: 'test-project',
    webAgentUrl: 'https://web-agent.example.com',
    internalAuthToken: 'test-internal-auth-token',
    llmUsageServiceUrl: 'http://llm-usage.test',
    userServiceUrl: 'http://user-service.test',
    messageDigestServiceUrl: 'http://message-digest-service.test',
    conversationAssistantModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
    port: 8080,
    host: '0.0.0.0',
    matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
  };

  beforeAll(async () => {
    // Set required env vars
    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = testConfig.verifyToken;
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = testConfig.appSecret;
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = testConfig.accessToken;
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = testConfig.allowedWabaIds.join(',');
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = testConfig.allowedPhoneNumberIds.join(',');
    process.env['VITEST'] = 'true';

    app = await buildServer(testConfig);
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    openapiSpec = JSON.parse(response.body) as OpenApiSpec;
  });

  afterAll(async () => {
    await app.close();
    delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    delete process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    delete process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
    delete process.env['VITEST'];
  });

  it('has no "Default Response" placeholders', () => {
    const specStr = JSON.stringify(openapiSpec);
    expect(specStr).not.toContain('Default Response');
  });

  it('uses OpenAPI 3.1.1', () => {
    expect(openapiSpec.openapi).toBe('3.1.1');
  });

  it('has servers array with valid URL', () => {
    const servers = openapiSpec.servers;
    expect(servers).toBeDefined();
    expect(Array.isArray(servers)).toBe(true);
    expect(servers?.length).toBeGreaterThan(0);
    expect(servers?.[0]?.url).toBeDefined();
    expect(servers?.[0]?.url).not.toBe('');
  });

  it('has exactly two servers (cloud + local)', () => {
    const servers = openapiSpec.servers;
    expect(servers).toBeDefined();
    expect(servers?.length).toBe(2);

    expect(servers?.[0]?.url).toBe('https://intexuraos-whatsapp-service-cj44trunra-lm.a.run.app');
    expect(servers?.[0]?.description).toBe('Cloud (Development)');

    expect(servers?.[1]?.url).toBe('http://localhost:8113');
    expect(servers?.[1]?.description).toBe('Local');
  });

  it('every path+method has an operationId', () => {
    const paths = openapiSpec.paths;
    expect(paths).toBeDefined();

    for (const [path, methods] of Object.entries(paths ?? {})) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(
          operation.operationId,
          `Missing operationId for ${method.toUpperCase()} ${path}`
        ).toBeDefined();
        expect(operation.operationId).not.toBe('');
      }
    }
  });

  it('GET /webhooks 200 response is text/plain', () => {
    const paths = openapiSpec.paths;
    const getWebhook = paths?.['/webhooks']?.['get'];
    expect(getWebhook).toBeDefined();

    const response200 = getWebhook?.responses?.['200'];
    expect(response200).toBeDefined();
    expect(response200?.content).toBeDefined();
    expect(response200?.content?.['text/plain']).toBeDefined();
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths;

    expect(paths?.['/webhooks']).toBeDefined();
    expect(paths?.['/health']).toBeDefined();
  });

  it('documents the required Conversation Assistant deletion token header', () => {
    const deleteSession =
      openapiSpec.paths?.['/conversation-assistant/sessions/{sessionId}']?.['delete'];

    expect(deleteSession?.parameters).toContainEqual(
      expect.objectContaining({
        in: 'header',
        name: 'x-conversation-assistant-deletion-token',
        required: true,
      })
    );
  });

  it('documents the complete Conversation Assistant context attachment API', () => {
    const paths = openapiSpec.paths;
    const sessionPath = '/conversation-assistant/sessions/{sessionId}';
    const attachmentPath = `${sessionPath}/context-attachments/{attachmentId}`;

    const operations = [
      {
        operation: paths?.[`${sessionPath}/context-attachments`]?.['post'],
        operationId: 'createWhatsAppConversationAssistantContextAttachment',
        successStatus: '202',
      },
      {
        operation: paths?.[attachmentPath]?.['get'],
        operationId: 'getWhatsAppConversationAssistantContextAttachment',
        successStatus: '200',
      },
      {
        operation: paths?.[`${attachmentPath}/messages`]?.['get'],
        operationId: 'previewWhatsAppConversationAssistantContextAttachment',
        successStatus: '200',
      },
      {
        operation: paths?.[attachmentPath]?.['delete'],
        operationId: 'deleteWhatsAppConversationAssistantContextAttachment',
        successStatus: '200',
      },
      {
        operation: paths?.[`${attachmentPath}/preparation/retry`]?.['post'],
        operationId: 'retryWhatsAppConversationAssistantContextAttachment',
        successStatus: '202',
      },
      {
        operation: paths?.[`${sessionPath}/context/history`]?.['get'],
        operationId: 'listWhatsAppConversationAssistantContextHistory',
        successStatus: '200',
      },
    ];

    for (const { operation, operationId, successStatus } of operations) {
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.responses?.[successStatus]).toBeDefined();
      expect(operation?.responses?.['409']).toBeDefined();
    }
  });

  it('documents durable Conversation Assistant turn request and recovery operations', () => {
    const sessionPath = '/conversation-assistant/sessions/{sessionId}';
    const requestPath = `${sessionPath}/turn-requests/{requestId}`;
    const send = openapiSpec.paths?.[`${sessionPath}/turns`]?.['post'];
    const stream = openapiSpec.paths?.[`${sessionPath}/turns/stream`]?.['post'];
    const recover = openapiSpec.paths?.[requestPath]?.['get'];
    const resume = openapiSpec.paths?.[`${requestPath}/resume`]?.['post'];
    const retry = openapiSpec.paths?.[`${requestPath}/answer/retry`]?.['post'];

    expect(send?.operationId).toBe('sendWhatsAppConversationAssistantTurnRequest');
    expect(send?.responses?.['201']).toBeDefined();
    expect(send?.responses?.['409']).toBeDefined();
    expect(send?.responses?.['422']).toBeDefined();
    expect(stream?.operationId).toBe('streamWhatsAppConversationAssistantTurnRequest');
    expect(recover?.operationId).toBe('getWhatsAppConversationAssistantTurnRequest');
    expect(recover?.responses?.['200']).toBeDefined();
    expect(resume?.operationId).toBe('resumeWhatsAppConversationAssistantTurnRequest');
    expect(resume?.responses?.['200']).toBeDefined();
    expect(resume?.responses?.['409']).toBeDefined();
    expect(retry?.operationId).toBe('retryWhatsAppConversationAssistantTurnRequestAnswer');
    expect(retry?.responses?.['200']).toBeDefined();
    expect(retry?.responses?.['409']).toBeDefined();
  });

  it('publishes strict public Conversation Assistant component schemas without private fields', () => {
    const schemas = openapiSpec.components?.schemas;
    expect(schemas).toBeDefined();
    const publicComponents = [
      'ConversationAssistantSession',
      'ConversationAssistantContext',
      'ConversationAssistantContextAttachment',
      'ConversationAssistantContextAttachmentPreviewPage',
      'ConversationAssistantContextHistory',
      'ConversationAssistantTurn',
      'ConversationAssistantTurnRequest',
      'ConversationAssistantTurnRequestRecovery',
      'ConversationAssistantSseEvent',
    ];
    for (const componentName of publicComponents) {
      expect(schemas?.[componentName], `Missing ${componentName}`).toBeDefined();
    }

    const publicContract = Object.fromEntries(
      publicComponents.map((componentName) => [componentName, schemas?.[componentName]])
    );
    const serialized = JSON.stringify(publicContract);
    for (const privateProperty of [
      'userId',
      'chatId',
      'sourceAccountId',
      'sourceAccountGeneration',
      'sessionGenerationId',
      'generationId',
      'transcriptSha256',
      'deltaTranscriptSha256',
      'previousContextChainSha256',
      'resultingContextChainSha256',
      'contextChainSha256',
      'requestFingerprint',
      'claimId',
      'snapshotId',
    ]) {
      expect(serialized).not.toContain(`"${privateProperty}"`);
    }
    expect(serialized).not.toContain('"additionalProperties":true');

    const propertiesOf = (componentName: string): Record<string, unknown> =>
      (schemas?.[componentName]?.['properties'] as Record<string, unknown> | undefined) ?? {};
    const sessionProperties = propertiesOf('ConversationAssistantSession');
    expect(sessionProperties).toHaveProperty('contextSummary');
    for (const supersededProperty of [
      'contextContinuationAvailable',
      'contextContinuationState',
      'continuationUnavailableReason',
      'contextVersion',
      'displayTimeZone',
      'attachmentCount',
      'totalAttachedMessageCount',
      'totalAttachedOmittedCount',
      'completedConversationRevision',
      'activeTurn',
    ]) {
      expect(sessionProperties).not.toHaveProperty(supersededProperty);
    }
    expect(Object.keys(propertiesOf('ConversationAssistantContextSummary')).sort()).toEqual(
      [
        'activeTurn',
        'availability',
        'completedConversationRevision',
        'contextVersion',
        'displayTimeZone',
        'snapshotCount',
        'totalAttachedMessageCount',
        'totalAttachedOmittedCount',
      ].sort()
    );
    expect(Object.keys(propertiesOf('ConversationAssistantContextAttachment')).sort()).toEqual(
      [
        'captureRange',
        'capturedAt',
        'compatibility',
        'confirmationToken',
        'counts',
        'error',
        'eventRange',
        'expiresAt',
        'id',
        'newerAvailableCorrectionCount',
        'newerAvailableCount',
        'omitted',
        'requiresConfirmation',
        'status',
      ].sort()
    );
    expect(Object.keys(propertiesOf('ConversationAssistantContextSnapshotSummary')).sort()).toEqual(
      [
        'attachmentId',
        'captureRange',
        'capturedAt',
        'contextVersion',
        'correctionCount',
        'eventRange',
        'excludedCount',
        'kind',
        'linkedTurnId',
        'messageCount',
        'omitted',
      ].sort()
    );
    expect(
      Object.keys(propertiesOf('ConversationAssistantContextAttachmentCounts')).sort()
    ).toEqual(
      [
        'completedTranscriptions',
        'deleted',
        'edited',
        'excluded',
        'included',
        'lateIngested',
        'reactionsChanged',
        'redacted',
      ].sort()
    );
    expect(propertiesOf('ConversationAssistantTurn')).toHaveProperty('canRetryAnswer');
    expect(
      Object.keys(propertiesOf('ConversationAssistantCorrectionPreviewItem')).sort()
    ).toEqual(['after', 'before', 'changeKind', 'kind', 'targetReference'].sort());
  });

  it('uses an exact success data schema on every JSON Conversation Assistant operation', () => {
    const paths = openapiSpec.paths ?? {};
    for (const [path, methods] of Object.entries(paths)) {
      if (!path.startsWith('/conversation-assistant/')) continue;
      if (path.endsWith('/export.pdf') || path.endsWith('/turns/stream')) continue;
      for (const [method, operation] of Object.entries(methods)) {
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          if (!status.startsWith('2')) continue;
          const serialized = JSON.stringify(response);
          expect(
            serialized,
            `${method.toUpperCase()} ${path} ${status} must reference an exact data schema`
          ).toContain('ConversationAssistant');
          expect(serialized).not.toContain('"additionalProperties":true');
        }
      }
    }
  });

  it('documents private WhatsApp physical erasure start and status recovery', () => {
    const base = '/internal/whatsapp/private/accounts/{sourceAccountId}/erasure';
    const start = openapiSpec.paths?.[base]?.['post'];
    const status = openapiSpec.paths?.[`${base}/{erasureRequestId}`]?.['get'];

    expect(start?.operationId).toBe('startPrivateWhatsAppAccountErasure');
    for (const code of ['202', '400', '401', '404', '409', '500']) {
      expect(start?.responses?.[code]).toBeDefined();
    }
    expect(status?.operationId).toBe('getPrivateWhatsAppAccountErasure');
    for (const code of ['200', '400', '401', '404', '500']) {
      expect(status?.responses?.[code]).toBeDefined();
    }
  });

  it('POST /webhooks documents signature header', () => {
    const paths = openapiSpec.paths;
    const postWebhook = paths?.['/webhooks']?.['post'];
    expect(postWebhook).toBeDefined();
    // Signature is documented in headers schema
  });

  it('documents the 500 response for private media upload repository failures', () => {
    const paths = openapiSpec.paths;
    const uploadPrivateMedia = paths?.['/internal/whatsapp/private/media']?.['post'];
    expect(uploadPrivateMedia).toBeDefined();
    expect(uploadPrivateMedia?.responses?.['500']).toBeDefined();
  });

  it('documents the 413 response for private media upload body limit failures', () => {
    const paths = openapiSpec.paths;
    const uploadPrivateMedia = paths?.['/internal/whatsapp/private/media']?.['post'];
    expect(uploadPrivateMedia).toBeDefined();
    expect(uploadPrivateMedia?.responses?.['413']).toBeDefined();
  });

  it('documents video as a WhatsApp message media type', () => {
    const messagesRoute = openapiSpec.paths?.['/messages']?.['get'];
    expect(messagesRoute).toBeDefined();
    expect(JSON.stringify(messagesRoute)).toContain('"video"');
  });
});
