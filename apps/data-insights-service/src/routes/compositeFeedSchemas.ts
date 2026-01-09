/**
 * JSON schemas for composite feed API validation.
 */

import {
  MAX_STATIC_SOURCES,
  MAX_NOTIFICATION_FILTERS,
  MAX_FEED_NAME_LENGTH,
  MAX_PURPOSE_LENGTH,
} from '../domain/compositeFeed/index.js';

/**
 * Schema for notification filter config input (id is optional, auto-generated if missing).
 */
export const notificationFilterConfigInputSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    app: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    },
    source: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    },
    title: { type: 'string', maxLength: 200 },
  },
  additionalProperties: false,
} as const;

/**
 * Schema for notification filter config output (id is always present).
 */
export const notificationFilterConfigSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    app: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    },
    source: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    },
    title: { type: 'string', maxLength: 200 },
  },
  additionalProperties: false,
} as const;

/**
 * Schema for create composite feed request body.
 */
export const createCompositeFeedBodySchema = {
  type: 'object',
  required: ['purpose', 'staticSourceIds', 'notificationFilters'],
  properties: {
    purpose: { type: 'string', minLength: 1, maxLength: MAX_PURPOSE_LENGTH },
    staticSourceIds: {
      type: 'array',
      items: { type: 'string' },
      maxItems: MAX_STATIC_SOURCES,
    },
    notificationFilters: {
      type: 'array',
      items: notificationFilterConfigInputSchema,
      maxItems: MAX_NOTIFICATION_FILTERS,
    },
  },
  additionalProperties: false,
} as const;

/**
 * Schema for update composite feed request body.
 */
export const updateCompositeFeedBodySchema = {
  type: 'object',
  properties: {
    purpose: { type: 'string', minLength: 1, maxLength: MAX_PURPOSE_LENGTH },
    staticSourceIds: {
      type: 'array',
      items: { type: 'string' },
      maxItems: MAX_STATIC_SOURCES,
    },
    notificationFilters: {
      type: 'array',
      items: notificationFilterConfigInputSchema,
      maxItems: MAX_NOTIFICATION_FILTERS,
    },
  },
  additionalProperties: false,
} as const;

/**
 * Schema for composite feed ID parameter.
 */
export const compositeFeedParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

/**
 * Schema for composite feed response.
 */
export const compositeFeedResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    name: { type: 'string', maxLength: MAX_FEED_NAME_LENGTH },
    purpose: { type: 'string' },
    staticSourceIds: {
      type: 'array',
      items: { type: 'string' },
    },
    notificationFilters: {
      type: 'array',
      items: notificationFilterConfigSchema,
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

/**
 * Schema for composite feed data response.
 */
export const compositeFeedDataResponseSchema = {
  type: 'object',
  properties: {
    feedId: { type: 'string' },
    feedName: { type: 'string' },
    purpose: { type: 'string' },
    generatedAt: { type: 'string', format: 'date-time' },
    staticSources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
    notifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filterId: { type: 'string' },
          filterName: { type: 'string' },
          criteria: {
            type: 'object',
            properties: {
              app: { type: 'array', items: { type: 'string' } },
              source: { type: 'array', items: { type: 'string' } },
              title: { type: 'string' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                app: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' },
                timestamp: { type: 'string' },
                source: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Schema for snapshot response (includes expiresAt).
 */
export const snapshotResponseSchema = {
  type: 'object',
  properties: {
    feedId: { type: 'string' },
    feedName: { type: 'string' },
    purpose: { type: 'string' },
    generatedAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    staticSources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
    notifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filterId: { type: 'string' },
          filterName: { type: 'string' },
          criteria: {
            type: 'object',
            properties: {
              app: { type: 'array', items: { type: 'string' } },
              source: { type: 'array', items: { type: 'string' } },
              title: { type: 'string' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                app: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' },
                timestamp: { type: 'string' },
                source: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;
