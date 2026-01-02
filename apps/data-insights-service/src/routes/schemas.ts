/**
 * OpenAPI schemas for data insights routes.
 */

export const analyticsEventSchema = {
  type: 'object',
  required: ['id', 'userId', 'sourceService', 'eventType', 'payload', 'timestamp', 'createdAt'],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    sourceService: { type: 'string' },
    eventType: { type: 'string' },
    payload: { type: 'object', additionalProperties: true },
    timestamp: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const createAnalyticsEventRequestSchema = {
  type: 'object',
  required: ['userId', 'sourceService', 'eventType', 'payload'],
  properties: {
    userId: { type: 'string', minLength: 1 },
    sourceService: { type: 'string', minLength: 1, maxLength: 100 },
    eventType: { type: 'string', minLength: 1, maxLength: 100 },
    payload: { type: 'object', additionalProperties: true },
    timestamp: { type: 'string', format: 'date-time' },
  },
} as const;

export const serviceUsageSchema = {
  type: 'object',
  required: ['serviceName', 'totalEvents', 'eventsLast7Days'],
  properties: {
    serviceName: { type: 'string' },
    totalEvents: { type: 'number' },
    eventsLast7Days: { type: 'number' },
    lastEventAt: { type: 'string', format: 'date-time', nullable: true },
  },
} as const;

export const insightsSummarySchema = {
  type: 'object',
  required: ['totalEvents', 'eventsLast7Days', 'eventsLast30Days'],
  properties: {
    totalEvents: { type: 'number' },
    eventsLast7Days: { type: 'number' },
    eventsLast30Days: { type: 'number' },
    mostActiveService: { type: 'string', nullable: true },
  },
} as const;

export const aggregatedInsightsSchema = {
  type: 'object',
  required: ['userId', 'summary', 'usageByService', 'updatedAt'],
  properties: {
    userId: { type: 'string' },
    summary: insightsSummarySchema,
    usageByService: {
      type: 'object',
      additionalProperties: serviceUsageSchema,
    },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;
