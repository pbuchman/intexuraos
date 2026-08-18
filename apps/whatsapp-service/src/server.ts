import Fastify, { type FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import {
  fastifyAuthPlugin,
  intexuraFastifyPlugin,
  registerQuietHealthCheckLogging,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import { type HealthCheck, registerHealthCheck } from '@intexuraos/http-server';
import { firestoreHealthCheck } from '@intexuraos/infra-firestore';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import { createWhatsappRoutes } from './routes/routes.js';
import { type Config, validateConfigEnv } from './config.js';
import { getServices, initServices } from './services.js';

const SERVICE_NAME = 'whatsapp-service';
const SERVICE_VERSION = '0.0.4';
const WHATSAPP_LOG_REDACTION = {
  paths: [
    'bodyPreview',
    'rawBody',
    'signatureReceived',
    'userId',
    'ownerUserId',
    'auth0UserId',
    'sourceAccountId',
    'chatId',
    'matrixEventId',
    'matrixRoomId',
    'phoneNumber',
    'normalizedPhone',
    'fromNumber',
    'recipientPhone',
    'phoneNumberId',
    'displayPhoneNumber',
    'senderPhoneNumber',
    'whatsappSender',
    'wabaId',
    'receivedWabaId',
    'receivedPhoneNumberId',
    'receivedDisplayPhoneNumber',
    'allowedWabaIds',
    'allowedPhoneNumberIds',
    'messageId',
    'waMessageId',
    'wamid',
    'replyToWamid',
    'replyToMessageId',
    'mediaId',
    'body.phoneNumber',
    'body.userId',
    'error.details.phoneNumber',
    'error.details.userId',
    'err.details.phoneNumber',
    'err.details.userId',
  ],
  censor: '[Redacted]',
};

/**
 * Probe required secrets using this service's bespoke validation logic
 * (`validateConfigEnv`). Wraps the validator in the functional `HealthCheck`
 * shape consumed by `registerHealthCheck`.
 */
function configEnvHealthCheck(): HealthCheck {
  return {
    name: 'secrets',
    check: (): Promise<{ ok: true } | { ok: false; detail?: string }> => {
      const missing = validateConfigEnv();
      if (missing.length === 0) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false, detail: `missing: ${missing.join(', ')}` });
    },
  };
}

function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  // Exactly two servers: Cloud Run deployment and local development
  const servers = [
    {
      url: 'https://intexuraos-whatsapp-service-cj44trunra-lm.a.run.app',
      description: 'Cloud (Development)',
    },
    { url: 'http://localhost:8113', description: 'Local' },
  ];

  return {
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, index): string {
        const schemaId = json['$id'];
        return typeof schemaId === 'string' ? schemaId : `def-${String(index)}`;
      },
    },
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS WhatsApp Service - WhatsApp Business Cloud API webhook handler',
        version: SERVICE_VERSION,
      },
      servers,
      components: {
        schemas: {
          ApiOk: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { type: 'object' },
              diagnostics: { $ref: '#/components/schemas/Diagnostics' },
            },
            required: ['success', 'data'],
          },
          ApiError: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: '#/components/schemas/ErrorBody' },
              diagnostics: { $ref: '#/components/schemas/Diagnostics' },
            },
            required: ['success', 'error'],
          },
          ErrorBody: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
          },
          Diagnostics: {
            type: 'object',
            properties: {
              requestId: { type: 'string' },
              durationMs: { type: 'number' },
            },
          },
        },
      },
      tags: [
        { name: 'webhooks', description: 'WhatsApp webhook endpoints' },
        { name: 'whatsapp', description: 'WhatsApp mapping management' },
        { name: 'system', description: 'System endpoints' },
      ],
    },
  };
}

export async function buildServer(
  config: Config,
  testLoggerStream?: NodeJS.WritableStream
): Promise<FastifyInstance> {
  // Initialize service container with config
  const serviceConfig = {
    mediaBucket: config.mediaBucket,
    gcpProjectId: config.gcpProjectId,
    mediaCleanupTopic: config.mediaCleanupTopic,
    audioStoredTopic: config.audioStoredTopic,
    intexMessageIngestTopic: config.intexMessageIngestTopic,
    whatsappAccessToken: config.accessToken,
    whatsappPhoneNumberId: config.allowedPhoneNumberIds[0] ?? '',
    webAgentUrl: config.webAgentUrl,
    internalAuthToken: config.internalAuthToken,
    ...(process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] === undefined
      ? {}
      : {
          internalAuthTokenPrevious:
            process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'],
        }),
    llmUsageServiceUrl: config.llmUsageServiceUrl,
    userServiceUrl: config.userServiceUrl,
    platformOpenRouterApiKey: config.platformOpenRouterApiKey,
    messageDigestServiceUrl: config.messageDigestServiceUrl,
    conversationAssistantModel: config.conversationAssistantModel,
    matrixOutboundAdapterBaseUrl: process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'] ?? '',
    matrixOutboundAdapterAuthToken:
      process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'] ?? '',
    intexAgentBaseUrl: process.env['INTEXURAOS_INTEX_AGENT_URL'] ?? '',
    matrixCorpus: config.matrixCorpus,
  };
  if (config.webhookProcessTopic !== undefined) {
    (serviceConfig as { webhookProcessTopic?: string }).webhookProcessTopic =
      config.webhookProcessTopic;
  }
  initServices(serviceConfig);

  const app = Fastify({
    // Keep router matching above the largest public path-parameter bound so
    // route schemas, rather than find-my-way's default 100-character limit,
    // produce the documented validation response.
    routerOptions: { maxParamLength: 512 },
    logger: testLoggerStream
      ? { level: 'info', redact: WHATSAPP_LOG_REDACTION, stream: testLoggerStream }
      : process.env['NODE_ENV'] === 'test'
        ? false
        : {
            level: process.env['LOG_LEVEL'] ?? 'info',
            redact: WHATSAPP_LOG_REDACTION,
            stream: createLogStream(),
          },
    disableRequestLogging: true, // We'll handle logging ourselves to skip health checks
  });

  // Matrix control-plane identifiers and errors are private even in global hooks.
  const matrixCorpusPrivatePaths = ['/internal/matrix-corpus/'] as const;
  registerQuietHealthCheckLogging(app, { privatePathPrefixes: matrixCorpusPrivatePaths });

  // Add content type parser to capture raw body
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      // Store raw body for signature validation
      (req as unknown as { rawBody: string }).rawBody = body as string;
      const json: unknown = JSON.parse(body as string);
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  await app.register(intexuraFastifyPlugin);

  // Register core schemas for $ref usage in routes (Diagnostics, ErrorCode, ErrorBody)
  registerCoreSchemas(app);

  // Register service-specific schemas
  app.addSchema({
    $id: 'WebhookReceivedResponse',
    type: 'object',
    properties: {
      received: { type: 'boolean' },
    },
  });

  // CORS for cross-origin API access (web app + api-docs-hub)
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });

  await app.register(fastifySwagger, buildOpenApiOptions());
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  // Register auth plugin (JWT validation)
  await app.register(fastifyAuthPlugin);

  setupSentryErrorHandler(app as unknown as FastifyInstance, {
    privatePathPrefixes: matrixCorpusPrivatePaths,
  });

  // Register whatsapp routes
  await app.register(createWhatsappRoutes(config));

  if (config.matrixCorpus.enabled) {
    const recoveryController = getServices().matrixCorpus?.recoveryController;
    if (recoveryController === undefined) {
      throw new Error('Matrix corpus recovery composition is unavailable');
    }
    app.addHook('onClose', async () => {
      await recoveryController.stop();
    });
  }

  // Health endpoint (NOT wrapped in envelope per api-contracts.md)
  await registerHealthCheck(app, {
    serviceName: SERVICE_NAME,
    version: SERVICE_VERSION,
    checks: [configEnvHealthCheck(), firestoreHealthCheck()],
  });

  // OpenAPI JSON endpoint
  app.get(
    '/openapi.json',
    {
      schema: {
        description: 'OpenAPI specification',
        tags: ['system'],
        hide: true,
      },
    },
    async (_req, reply) => {
      const spec = app.swagger();
      return await reply.type('application/json').send(spec);
    }
  );

  return await Promise.resolve(app);
}
