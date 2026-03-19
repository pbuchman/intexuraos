export const commandSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    sourceType: { type: 'string', enum: ['whatsapp_text', 'whatsapp_voice', 'pwa-shared'] },
    externalId: { type: 'string' },
    text: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    status: {
      type: 'string',
      enum: ['received', 'classified', 'pending_classification', 'failed', 'archived'],
    },
    classification: {
      type: 'object',
      nullable: true,
      properties: {
        type: {
          type: 'string',
          enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder', 'linear', 'code'],
        },
        confidence: { type: 'number' },
        reasoning: { type: 'string' },
        promptVersion: { type: 'string' },
        classifiedAt: { type: 'string', format: 'date-time' },
      },
    },
    actionId: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'userId',
    'sourceType',
    'externalId',
    'text',
    'timestamp',
    'status',
    'createdAt',
    'updatedAt',
  ],
} as const;
