/**
 * OpenAPI schemas for mobile notifications routes.
 */

export const notificationSchema = {
  type: 'object',
  required: [
    'id',
    'source',
    'device',
    'app',
    'title',
    'text',
    'timestamp',
    'postTime',
    'receivedAt',
  ],
  properties: {
    id: { type: 'string' },
    source: { type: 'string' },
    device: { type: 'string' },
    app: { type: 'string' },
    title: { type: 'string' },
    text: { type: 'string' },
    timestamp: { type: 'number' },
    postTime: { type: 'string' },
    receivedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const connectRequestSchema = {
  type: 'object',
  properties: {
    deviceLabel: { type: 'string' },
  },
} as const;

export const connectResponseSchema = {
  type: 'object',
  required: ['connectionId', 'signature'],
  properties: {
    connectionId: { type: 'string' },
    signature: {
      type: 'string',
      description: 'Plaintext signature - store securely, only shown once',
    },
  },
} as const;

export const webhookRequestSchema = {
  type: 'object',
  required: [
    'source',
    'device',
    'timestamp',
    'notification_id',
    'post_time',
    'app',
    'title',
    'text',
  ],
  properties: {
    source: { type: 'string' },
    device: { type: 'string' },
    timestamp: { type: 'number' },
    notification_id: { type: 'string' },
    post_time: { type: 'string' },
    app: { type: 'string' },
    title: { type: 'string' },
    text: { type: 'string' },
  },
} as const;

export const webhookResponseSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['accepted', 'ignored'] },
    id: { type: 'string' },
    reason: { type: 'string' },
  },
} as const;

export const listNotificationsResponseSchema = {
  type: 'object',
  required: ['notifications'],
  properties: {
    notifications: {
      type: 'array',
      items: notificationSchema,
    },
    nextCursor: { type: 'string' },
  },
} as const;
