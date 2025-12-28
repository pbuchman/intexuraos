/**
 * HTTP Contracts package - shared API contract definitions.
 *
 * This package provides:
 * - OpenAPI schema definitions for IntexuraOS APIs
 * - Fastify JSON Schemas for route validation
 * - Reusable schema patterns across services
 */

// OpenAPI schemas for swagger configuration
export {
  ERROR_CODES,
  ErrorCodeSchema,
  DiagnosticsSchema,
  ErrorBodySchema,
  ApiOkSchema,
  ApiErrorSchema,
  HealthCheckSchema,
  HealthResponseSchema,
  coreComponentSchemas,
  bearerAuthSecurityScheme,
} from './openapi-schemas.js';

// Fastify schemas for route validation
export {
  fastifyDiagnosticsSchema,
  fastifyErrorCodeSchema,
  fastifyErrorBodySchema,
  registerCoreSchemas,
} from './fastify-schemas.js';
