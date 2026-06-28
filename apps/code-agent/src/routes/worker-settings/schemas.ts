/**
 * Shared JSON schemas for worker settings routes.
 *
 * Extracted from the monolithic `workerSettingsRoutes.ts` so every
 * resource-specific sub-plugin can import only the schemas it needs.
 */

import { CODE_TASK_WORKER_TYPES } from '@intexuraos/code-task-domain';
import { MAX_WORKERS_PER_USER } from '../../domain/models/workerSettings.js';

/** Body schema for `POST /code/worker-settings/workers`. */
export const addWorkerSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 32,
    },
    url: { type: 'string', format: 'uri' },
    cfAccessClientId: { type: 'string', minLength: 1 },
    cfAccessClientSecret: { type: 'string', minLength: 1 },
    dispatchSigningSecret: { type: 'string', minLength: 1 },
  },
  required: ['name', 'url', 'cfAccessClientId', 'cfAccessClientSecret', 'dispatchSigningSecret'],
} as const;

/** Body schema for `PATCH /code/worker-settings/workers/:name`. */
export const updateWorkerSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', format: 'uri' },
    cfAccessClientId: { type: 'string', minLength: 1 },
    cfAccessClientSecret: { type: 'string', minLength: 1 },
    dispatchSigningSecret: { type: 'string', minLength: 1 },
    enabled: { type: 'boolean' },
  },
} as const;

/** Body schema for `PUT /code/worker-settings/priority`. */
export const reorderSchema = {
  type: 'object',
  properties: {
    workerNames: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: MAX_WORKERS_PER_USER,
    },
  },
  required: ['workerNames'],
} as const;

/** Masked worker config schema used inside the GET response. */
export const maskedWorkerConfigSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    url: { type: 'string' },
    cfAccessClientId: { type: 'string' },
    cfAccessClientSecret: { type: 'string' },
    dispatchSigningSecret: { type: 'string' },
    enabled: { type: 'boolean' },
    lastTestedAt: { type: 'string', nullable: true },
    testStatus: { type: 'string', enum: ['success', 'failure'], nullable: true },
    testMessage: { type: 'string', nullable: true },
  },
  required: ['name', 'url', 'cfAccessClientId', 'cfAccessClientSecret', 'dispatchSigningSecret', 'enabled'],
} as const;

/** Body schema for the 6 PATCH default-*-worker-type endpoints. */
export const defaultWorkerTypeBody = {
  type: 'object',
  properties: {
    workerType: { type: 'string', enum: [...CODE_TASK_WORKER_TYPES] },
  },
  required: ['workerType'],
} as const;

/** Shared response schema for the 6 PATCH default-*-worker-type endpoints. */
export const defaultWorkerTypeResponse = {
  200: {
    description: 'Default worker type updated',
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        properties: {
          updated: { type: 'boolean', enum: [true] },
        },
        required: ['updated'],
      },
    },
  },
  400: {
    description: 'Invalid request',
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', enum: ['INVALID_REQUEST'] },
          message: { type: 'string' },
        },
      },
    },
  },
  401: {
    description: 'Unauthorized',
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', enum: ['UNAUTHORIZED'] },
          message: { type: 'string' },
        },
      },
    },
  },
  500: {
    description: 'Internal server error',
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', enum: ['INTERNAL_ERROR'] },
          message: { type: 'string' },
        },
      },
    },
  },
} as const;
