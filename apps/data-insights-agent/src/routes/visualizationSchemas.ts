/**
 * JSON schemas for visualization API validation.
 */

import {
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from '../domain/visualization/index.js';

/**
 * Schema for visualization type enum.
 */
const visualizationTypeSchema = {
  type: 'string',
  enum: ['chart', 'table', 'summary', 'custom'],
} as const;

/**
 * Schema for visualization status enum.
 */
const visualizationStatusSchema = {
  type: 'string',
  enum: ['pending', 'ready', 'error'],
} as const;

/**
 * Schema for create visualization request body.
 */
export const createVisualizationBodySchema = {
  type: 'object',
  required: ['title', 'description', 'type'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
    description: { type: 'string', minLength: 1, maxLength: MAX_DESCRIPTION_LENGTH },
    type: visualizationTypeSchema,
  },
  additionalProperties: false,
} as const;

/**
 * Schema for update visualization request body.
 */
export const updateVisualizationBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
    description: { type: 'string', minLength: 1, maxLength: MAX_DESCRIPTION_LENGTH },
    type: visualizationTypeSchema,
  },
  additionalProperties: false,
} as const;

/**
 * Schema for composite feed ID parameter.
 */
export const feedIdParamsSchema = {
  type: 'object',
  required: ['feedId'],
  properties: {
    feedId: { type: 'string', minLength: 1 },
  },
} as const;

/**
 * Schema for visualization ID parameter.
 */
export const visualizationParamsSchema = {
  type: 'object',
  required: ['feedId', 'id'],
  properties: {
    feedId: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
  },
} as const;

/**
 * Schema for report render error request body.
 */
export const reportRenderErrorBodySchema = {
  type: 'object',
  required: ['errorMessage'],
  properties: {
    errorMessage: { type: 'string', minLength: 1, maxLength: 2000 },
  },
  additionalProperties: false,
} as const;

/**
 * Schema for visualization response.
 */
export const visualizationResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    feedId: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    type: visualizationTypeSchema,
    status: visualizationStatusSchema,
    htmlContent: { type: ['string', 'null'] },
    errorMessage: { type: ['string', 'null'] },
    renderErrorCount: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    lastGeneratedAt: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;
