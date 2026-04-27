/**
 * Fastify server bootstrap for user-service.
 *
 * Delegates Fastify wiring (logger / cors / formbody / auth / Sentry handler /
 * swagger / `/health` / `/openapi.json`) to the shared
 * `createFastifyApp` helper from `@intexuraos/http-server`. Service-specific
 * route registration is supplied via `registerRoutes`.
 */
import type { FastifyInstance } from 'fastify';
import { checkFirestore, createFastifyApp } from '@intexuraos/http-server';
import { authRoutes } from './routes/routes.js';

const SERVICE_NAME = 'user-service';
const SERVICE_VERSION = '0.0.4';

const REQUIRED_SECRETS = [
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_CLIENT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
] as const;

const ADDITIONAL_OPENAPI_SCHEMAS = {
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
      code: { $ref: '#/components/schemas/ErrorCode' },
      message: { type: 'string' },
      details: { type: 'object' },
    },
  },
  ErrorCode: {
    type: 'string',
    enum: [
      'INVALID_REQUEST',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'DOWNSTREAM_ERROR',
      'INTERNAL_ERROR',
      'MISCONFIGURED',
    ],
  },
  Diagnostics: {
    type: 'object',
    properties: {
      requestId: { type: 'string' },
      durationMs: { type: 'number' },
      downstreamStatus: { type: 'integer' },
      downstreamRequestId: { type: 'string' },
      endpointCalled: { type: 'string' },
    },
  },
  HealthResponse: {
    type: 'object',
    required: ['status', 'serviceName', 'version', 'timestamp', 'checks'],
    properties: {
      status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
      serviceName: { type: 'string' },
      version: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      checks: {
        type: 'array',
        items: { $ref: '#/components/schemas/HealthCheck' },
      },
    },
  },
  HealthCheck: {
    type: 'object',
    required: ['name', 'status', 'latencyMs'],
    properties: {
      name: { type: 'string' },
      status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
      latencyMs: { type: 'number' },
      details: { type: 'object', nullable: true },
    },
  },
} as const;

export async function buildServer(): Promise<FastifyInstance> {
  return await createFastifyApp({
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    openapiInfo: {
      title: SERVICE_NAME,
      description: 'IntexuraOS Authentication Service - Device Authorization Flow helpers',
      version: SERVICE_VERSION,
    },
    openapiServers: [
      {
        url: 'https://intexuraos-user-service-cj44trunra-lm.a.run.app',
        description: 'Cloud (Development)',
      },
      { url: 'http://localhost:8110', description: 'Local' },
    ],
    openapiTags: [
      { name: 'system', description: 'System endpoints (health, docs)' },
      { name: 'auth', description: 'Device Authorization Flow helpers' },
    ],
    requiredSecrets: REQUIRED_SECRETS,
    extraHealthChecks: [checkFirestore],
    additionalOpenapiSchemas: ADDITIONAL_OPENAPI_SCHEMAS,
    registerRoutes: async (app) => {
      await app.register(authRoutes);
    },
  });
}
