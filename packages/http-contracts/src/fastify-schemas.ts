/**
 * Fastify JSON Schemas for IntexuraOS APIs.
 * These schemas use $id for local reference (not OpenAPI $ref).
 *
 * Usage:
 *   app.addSchema(fastifyDiagnosticsSchema);
 *   // Then reference as { $ref: 'Diagnostics#' } in route schemas
 */

/**
 * Fastify schema for Diagnostics with $id.
 */
export const fastifyDiagnosticsSchema = {
  $id: 'Diagnostics',
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
 * Fastify schema for ErrorCode with $id.
 */
export const fastifyErrorCodeSchema = {
  $id: 'ErrorCode',
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
 * Fastify schema for ErrorBody with $id.
 */
export const fastifyErrorBodySchema = {
  $id: 'ErrorBody',
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { $ref: 'ErrorCode#' },
    message: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
};

/**
 * Register all core Fastify schemas on an app instance.
 * Call this after creating the Fastify instance.
 *
 * Usage:
 *   const app = Fastify();
 *   registerCoreSchemas(app);
 */
export function registerCoreSchemas(app: { addSchema: (schema: { $id: string }) => void }): void {
  app.addSchema(fastifyDiagnosticsSchema);
  app.addSchema(fastifyErrorCodeSchema);
  app.addSchema(fastifyErrorBodySchema);
}
