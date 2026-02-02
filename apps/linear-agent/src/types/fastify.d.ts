/**
 * Fastify type extensions for linear-agent.
 */

// These imports are required for module augmentation to work with TypeScript's moduleResolution: "nodenext"
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { RawServerDefault, RawRequestDefaultExpression, RawServerBase } from 'fastify/types/utils';
import type { FastifySchema, FastifyTypeProviderDefault, ContextConfigDefault, FastifyBaseLogger } from 'fastify';
import type { ResolveFastifyRequestType } from 'fastify/types/type-provider';
import type { FastifyRouteGenericInterface } from 'fastify/types/route';
/* eslint-enable @typescript-eslint/no-unused-vars */

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw request body for webhook signature validation */
    rawBody?: string;
  }

  interface FastifyContextConfig {
    /** Flag to enable raw body parsing for webhook signature validation */
    rawBody?: boolean;
  }
}
