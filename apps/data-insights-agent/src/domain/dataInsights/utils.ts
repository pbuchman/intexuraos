/**
 * Shared utilities for data insights domain.
 */

/**
 * Build JSON schema representation of composite feed data.
 * Used by LLM-facing use cases to describe the data shape.
 */
export function buildCompositeFeedSchema(): object {
  return {
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
                source: { type: 'string' },
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
  };
}
