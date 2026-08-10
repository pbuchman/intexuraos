/**
 * Tests for Fastify JSON schemas.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  contractFastifySchemas,
  fastifyDiagnosticsSchema,
  fastifyErrorBodySchema,
  fastifyErrorCodeSchema,
  registerCoreSchemas,
} from '../fastify-schemas.js';

describe('Fastify Schemas', () => {
  describe('fastifyDiagnosticsSchema', () => {
    it('has correct $id', () => {
      expect(fastifyDiagnosticsSchema.$id).toBe('Diagnostics');
    });

    it('is an object type schema', () => {
      expect(fastifyDiagnosticsSchema.type).toBe('object');
    });

    it('has all expected properties', () => {
      const props = fastifyDiagnosticsSchema.properties;
      expect(props.requestId.type).toBe('string');
      expect(props.durationMs.type).toBe('number');
      expect(props.downstreamStatus.type).toBe('integer');
      expect(props.downstreamRequestId.type).toBe('string');
      expect(props.endpointCalled.type).toBe('string');
    });
  });

  describe('fastifyErrorCodeSchema', () => {
    it('has correct $id', () => {
      expect(fastifyErrorCodeSchema.$id).toBe('ErrorCode');
    });

    it('is a string type schema', () => {
      expect(fastifyErrorCodeSchema.type).toBe('string');
    });

    it('has all expected error codes', () => {
      const codes = fastifyErrorCodeSchema.enum;
      expect(codes).toContain('INVALID_REQUEST');
      expect(codes).toContain('EMPTY_TRANSCRIPT');
      expect(codes).toContain('UNAUTHORIZED');
      expect(codes).toContain('FORBIDDEN');
      expect(codes).toContain('NOT_FOUND');
      expect(codes).toContain('CONFLICT');
      expect(codes).toContain('SERVICE_UNAVAILABLE');
      expect(codes).toContain('DOWNSTREAM_ERROR');
      expect(codes).toContain('INTERNAL_ERROR');
      expect(codes).toContain('MISCONFIGURED');
      expect(codes.length).toBe(10);
    });
  });

  describe('fastifyErrorBodySchema', () => {
    it('has correct $id', () => {
      expect(fastifyErrorBodySchema.$id).toBe('ErrorBody');
    });

    it('is an object type schema', () => {
      expect(fastifyErrorBodySchema.type).toBe('object');
    });

    it('has required fields', () => {
      expect(fastifyErrorBodySchema.required).toContain('code');
      expect(fastifyErrorBodySchema.required).toContain('message');
    });

    it('references ErrorCode schema', () => {
      expect(fastifyErrorBodySchema.properties.code.$ref).toBe('ErrorCode#');
    });
  });

  describe('contractFastifySchemas', () => {
    it('does not include retired command contract schemas', () => {
      expect(contractFastifySchemas).not.toHaveProperty('CommandsCommandWithText');
      expect(contractFastifySchemas).not.toHaveProperty('CommandsGetCommandData');
    });

    it('includes calendar event list schemas', () => {
      expect(contractFastifySchemas).toHaveProperty('CalendarListEventsRequest');
      expect(contractFastifySchemas).toHaveProperty('CalendarListEventsData');
      expect(contractFastifySchemas).toHaveProperty('IntexAgentTestRunList');
      expect(contractFastifySchemas).toHaveProperty('IntexAgentTestRun');
      expect(contractFastifySchemas).toHaveProperty('IntexAgentTestScenario');

      const requestSchema = contractFastifySchemas.CalendarListEventsRequest as {
        required?: string[];
        properties?: {
          maxResults?: {
            minimum?: number;
            maximum?: number;
          };
        };
      };
      const dataSchema = contractFastifySchemas.CalendarListEventsData as {
        required?: string[];
        properties?: {
          events?: {
            type?: string;
          };
          truncated?: {
            type?: string;
          };
        };
      };

      expect(requestSchema.required).toEqual(['userId', 'timeMin', 'timeMax']);
      expect(requestSchema.properties?.maxResults?.minimum).toBe(1);
      expect(requestSchema.properties?.maxResults?.maximum).toBe(2500);
      expect(dataSchema.required).toEqual(['events', 'truncated']);
      expect(dataSchema.properties?.events?.type).toBe('array');
      expect(dataSchema.properties?.truncated?.type).toBe('boolean');
    });

    it('includes strict calendar attendee update schemas', () => {
      expect(contractFastifySchemas).toHaveProperty('CalendarUpdateEventAttendeesRequest');
      expect(contractFastifySchemas).toHaveProperty('CalendarUpdateEventAttendeesData');

      const requestSchema = contractFastifySchemas.CalendarUpdateEventAttendeesRequest as {
        additionalProperties?: boolean;
        required?: string[];
        properties?: {
          attendeesToAdd?: {
            type?: string;
            minItems?: number;
            items?: {
              type?: string;
              additionalProperties?: boolean;
              required?: string[];
              properties?: {
                email?: {
                  type?: string;
                  format?: string;
                };
              };
            };
          };
        };
      };
      const dataSchema = contractFastifySchemas.CalendarUpdateEventAttendeesData as {
        additionalProperties?: boolean;
        required?: string[];
        properties?: {
          event?: {
            type?: string;
            required?: string[];
          };
        };
      };

      expect(requestSchema.additionalProperties).toBe(false);
      expect(requestSchema.required).toEqual([
        'userId',
        'calendarId',
        'expectedEtag',
        'attendeesToAdd',
      ]);
      expect(requestSchema.properties?.attendeesToAdd?.type).toBe('array');
      expect(requestSchema.properties?.attendeesToAdd?.minItems).toBe(1);
      expect(requestSchema.properties?.attendeesToAdd?.items?.type).toBe('object');
      expect(requestSchema.properties?.attendeesToAdd?.items?.additionalProperties).toBe(false);
      expect(requestSchema.properties?.attendeesToAdd?.items?.required).toEqual(['email']);
      expect(requestSchema.properties?.attendeesToAdd?.items?.properties?.email?.format).toBe(
        'email'
      );
      expect(dataSchema.additionalProperties).toBe(false);
      expect(dataSchema.required).toEqual(['event']);
      expect(dataSchema.properties?.event?.type).toBe('object');
      expect(dataSchema.properties?.event?.required).toEqual(['id', 'summary', 'start', 'end']);
    });
  });

  describe('registerCoreSchemas', () => {
    it('registers all core schemas on the app', () => {
      const addSchema = vi.fn();
      const mockApp = { addSchema };

      registerCoreSchemas(mockApp);

      expect(addSchema).toHaveBeenCalledTimes(3 + Object.keys(contractFastifySchemas).length);
      expect(addSchema).toHaveBeenCalledWith(fastifyDiagnosticsSchema);
      expect(addSchema).toHaveBeenCalledWith(fastifyErrorCodeSchema);
      expect(addSchema).toHaveBeenCalledWith(fastifyErrorBodySchema);
      expect(addSchema).toHaveBeenCalledWith(contractFastifySchemas.ServiceFeedback);
      expect(addSchema).toHaveBeenCalledWith(contractFastifySchemas.CalendarCreateEventRequest);
      expect(addSchema).toHaveBeenCalledWith(contractFastifySchemas.CalendarListEventsRequest);
      expect(addSchema).toHaveBeenCalledWith(contractFastifySchemas.CalendarListEventsData);
      expect(addSchema).toHaveBeenCalledWith(
        contractFastifySchemas.CalendarUpdateEventAttendeesRequest
      );
      expect(addSchema).toHaveBeenCalledWith(
        contractFastifySchemas.CalendarUpdateEventAttendeesData
      );
      expect(addSchema).toHaveBeenCalledWith(contractFastifySchemas.CalendarCreatedEvent);
      expect(addSchema).toHaveBeenCalledWith(contractFastifySchemas.CalendarPreview);
    });
  });
});
