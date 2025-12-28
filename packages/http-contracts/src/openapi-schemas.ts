/**
 * OpenAPI JSON Schema definitions for IntexuraOS APIs.
 * These schemas are used in @fastify/swagger configuration.
 *
 * Note: These are JSON Schema definitions (for OpenAPI), not TypeScript types.
 * TypeScript types are defined separately in @intexuraos/common.
 */

/**
 * Error codes supported by IntexuraOS APIs.
 */
export const ERROR_CODES = [
  'INVALID_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'DOWNSTREAM_ERROR',
  'INTERNAL_ERROR',
  'MISCONFIGURED',
] as const;

/**
 * OpenAPI schema for ErrorCode enum.
 */
export const ErrorCodeSchema = {
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
};

/**
 * OpenAPI schema for Diagnostics object.
 */
export const DiagnosticsSchema = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    durationMs: { type: 'number' },
    downstreamStatus: { type: 'integer' },
    downstreamRequestId: { type: 'string' },
    endpointCalled: { type: 'string' },
  },
};

/**
 * OpenAPI schema for ErrorBody object.
 */
export const ErrorBodySchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { $ref: '#/components/schemas/ErrorCode' },
    message: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
};

/**
 * OpenAPI schema for successful API response envelope.
 */
export const ApiOkSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: { type: 'object' },
    diagnostics: { $ref: '#/components/schemas/Diagnostics' },
  },
  required: ['success', 'data'],
};

/**
 * OpenAPI schema for error API response envelope.
 */
export const ApiErrorSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { $ref: '#/components/schemas/ErrorBody' },
    diagnostics: { $ref: '#/components/schemas/Diagnostics' },
  },
  required: ['success', 'error'],
};

/**
 * OpenAPI schema for HealthCheck object.
 */
export const HealthCheckSchema = {
  type: 'object',
  required: ['name', 'status', 'latencyMs'],
  properties: {
    name: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
    latencyMs: { type: 'number' },
    details: { type: 'object', nullable: true },
  },
};

/**
 * OpenAPI schema for HealthResponse object.
 */
export const HealthResponseSchema = {
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
};

/**
 * Core OpenAPI component schemas used across all IntexuraOS services.
 * These can be spread into your OpenAPI components.schemas definition.
 */
export const coreComponentSchemas = {
  ErrorCode: ErrorCodeSchema,
  Diagnostics: DiagnosticsSchema,
  ErrorBody: ErrorBodySchema,
  ApiOk: ApiOkSchema,
  ApiError: ApiErrorSchema,
  HealthCheck: HealthCheckSchema,
  HealthResponse: HealthResponseSchema,
};

/**
 * Security scheme for Bearer JWT authentication.
 */
export const bearerAuthSecurityScheme = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'JWT token validated via JWKS. Token must include valid iss (issuer), aud (audience), and sub (user ID) claims.',
};
