import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';

export const SERVICE_NAME = 'cron-agent';
export const SERVICE_VERSION = '1.0.0';

export function buildOpenApiOptions(): FastifyDynamicSwaggerOptions {
  const servers = [
    { url: 'http://localhost:8130', description: 'Local' },
  ];

  return {
    openapi: {
      openapi: '3.1.1',
      info: {
        title: SERVICE_NAME,
        description: 'IntexuraOS Cron Agent - LLM-driven recurring schedule execution',
        version: SERVICE_VERSION,
      },
      servers,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
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
        },
      },
      tags: [
        { name: 'system', description: 'System endpoints (health, docs)' },
        { name: 'schedules', description: 'Schedule management operations' },
        { name: 'executions', description: 'Execution log operations' },
        { name: 'internal', description: 'Internal service-to-service endpoints' },
      ],
    },
  };
}
