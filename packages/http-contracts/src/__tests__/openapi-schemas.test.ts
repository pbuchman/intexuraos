/**
 * Tests for OpenAPI JSON schemas.
 */
import { describe, it, expect } from 'vitest';
import {
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
} from '../openapi-schemas.js';

describe('OpenAPI Schemas', () => {
  describe('ERROR_CODES', () => {
    it('contains all expected error codes', () => {
      expect(ERROR_CODES).toContain('INVALID_REQUEST');
      expect(ERROR_CODES).toContain('UNAUTHORIZED');
      expect(ERROR_CODES).toContain('FORBIDDEN');
      expect(ERROR_CODES).toContain('NOT_FOUND');
      expect(ERROR_CODES).toContain('CONFLICT');
      expect(ERROR_CODES).toContain('DOWNSTREAM_ERROR');
      expect(ERROR_CODES).toContain('INTERNAL_ERROR');
      expect(ERROR_CODES).toContain('MISCONFIGURED');
      expect(ERROR_CODES.length).toBe(8);
    });
  });

  describe('ErrorCodeSchema', () => {
    it('is a string type with enum', () => {
      expect(ErrorCodeSchema.type).toBe('string');
      expect(ErrorCodeSchema.enum).toEqual(expect.arrayContaining(['INVALID_REQUEST']));
    });
  });

  describe('DiagnosticsSchema', () => {
    it('is an object type', () => {
      expect(DiagnosticsSchema.type).toBe('object');
    });

    it('has expected properties', () => {
      const props = DiagnosticsSchema.properties;
      expect(props.requestId.type).toBe('string');
      expect(props.durationMs.type).toBe('number');
      expect(props.downstreamStatus.type).toBe('integer');
      expect(props.downstreamRequestId.type).toBe('string');
      expect(props.endpointCalled.type).toBe('string');
    });
  });

  describe('ErrorBodySchema', () => {
    it('has required code and message', () => {
      expect(ErrorBodySchema.required).toContain('code');
      expect(ErrorBodySchema.required).toContain('message');
    });

    it('references ErrorCode schema', () => {
      expect(ErrorBodySchema.properties.code.$ref).toBe('#/components/schemas/ErrorCode');
    });
  });

  describe('ApiOkSchema', () => {
    it('has required success and data', () => {
      expect(ApiOkSchema.required).toContain('success');
      expect(ApiOkSchema.required).toContain('data');
    });

    it('has success enum [true]', () => {
      expect(ApiOkSchema.properties.success.enum).toEqual([true]);
    });

    it('references Diagnostics schema', () => {
      expect(ApiOkSchema.properties.diagnostics.$ref).toBe('#/components/schemas/Diagnostics');
    });
  });

  describe('ApiErrorSchema', () => {
    it('has required success and error', () => {
      expect(ApiErrorSchema.required).toContain('success');
      expect(ApiErrorSchema.required).toContain('error');
    });

    it('has success enum [false]', () => {
      expect(ApiErrorSchema.properties.success.enum).toEqual([false]);
    });

    it('references ErrorBody schema', () => {
      expect(ApiErrorSchema.properties.error.$ref).toBe('#/components/schemas/ErrorBody');
    });
  });

  describe('HealthCheckSchema', () => {
    it('has required name, status, and latencyMs', () => {
      expect(HealthCheckSchema.required).toContain('name');
      expect(HealthCheckSchema.required).toContain('status');
      expect(HealthCheckSchema.required).toContain('latencyMs');
    });

    it('has status enum with correct values', () => {
      expect(HealthCheckSchema.properties.status.enum).toEqual(['ok', 'degraded', 'down']);
    });

    it('has nullable details', () => {
      expect(HealthCheckSchema.properties.details.nullable).toBe(true);
    });
  });

  describe('HealthResponseSchema', () => {
    it('has all required fields', () => {
      expect(HealthResponseSchema.required).toContain('status');
      expect(HealthResponseSchema.required).toContain('serviceName');
      expect(HealthResponseSchema.required).toContain('version');
      expect(HealthResponseSchema.required).toContain('timestamp');
      expect(HealthResponseSchema.required).toContain('checks');
    });

    it('has checks array referencing HealthCheck', () => {
      expect(HealthResponseSchema.properties.checks.type).toBe('array');
      expect(HealthResponseSchema.properties.checks.items.$ref).toBe(
        '#/components/schemas/HealthCheck'
      );
    });
  });

  describe('coreComponentSchemas', () => {
    it('contains all core schemas', () => {
      expect(coreComponentSchemas.ErrorCode).toBe(ErrorCodeSchema);
      expect(coreComponentSchemas.Diagnostics).toBe(DiagnosticsSchema);
      expect(coreComponentSchemas.ErrorBody).toBe(ErrorBodySchema);
      expect(coreComponentSchemas.ApiOk).toBe(ApiOkSchema);
      expect(coreComponentSchemas.ApiError).toBe(ApiErrorSchema);
      expect(coreComponentSchemas.HealthCheck).toBe(HealthCheckSchema);
      expect(coreComponentSchemas.HealthResponse).toBe(HealthResponseSchema);
    });
  });

  describe('bearerAuthSecurityScheme', () => {
    it('has correct type and scheme', () => {
      expect(bearerAuthSecurityScheme.type).toBe('http');
      expect(bearerAuthSecurityScheme.scheme).toBe('bearer');
      expect(bearerAuthSecurityScheme.bearerFormat).toBe('JWT');
    });

    it('has description', () => {
      expect(bearerAuthSecurityScheme.description).toContain('JWT token');
    });
  });
});
