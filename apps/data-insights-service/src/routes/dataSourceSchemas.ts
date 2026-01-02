/**
 * JSON schemas for data source API validation.
 */

import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from '../domain/dataSource/index.js';

/**
 * Schema for create data source request body.
 */
export const createDataSourceBodySchema = {
  type: 'object',
  required: ['title', 'content'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
    content: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_LENGTH },
  },
  additionalProperties: false,
} as const;

/**
 * Schema for update data source request body.
 */
export const updateDataSourceBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
    content: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_LENGTH },
  },
  additionalProperties: false,
} as const;

/**
 * Schema for generate title request body.
 */
export const generateTitleBodySchema = {
  type: 'object',
  required: ['content'],
  properties: {
    content: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_LENGTH },
  },
  additionalProperties: false,
} as const;

/**
 * Schema for data source ID parameter.
 */
export const dataSourceParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

/**
 * Schema for data source response.
 */
export const dataSourceResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    content: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

/**
 * Schema for generate title response.
 */
export const generateTitleResponseSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
  },
} as const;
