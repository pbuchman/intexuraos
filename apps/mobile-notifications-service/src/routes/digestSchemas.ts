export const runRequestSchema = {
  type: 'object',
  required: ['userId', 'groupKey', 'date'],
  properties: {
    userId: { type: 'string' },
    groupKey: { type: 'string' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
} as const;

export const runResponseSchema = {
  type: 'object',
  required: ['summaryDocId', 'generation', 'messageCount', 'modelId', 'regenerated'],
  properties: {
    summaryDocId: { type: 'string' },
    generation: { type: 'number' },
    messageCount: { type: 'number' },
    modelId: { type: 'string' },
    regenerated: { type: 'boolean' },
    lockSkipped: { type: 'boolean' },
  },
} as const;
