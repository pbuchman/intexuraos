export const tokenUsageSchema = {
  type: ['object', 'null'],
  properties: {
    inputTokens: { type: 'number' },
    outputTokens: { type: 'number' },
    totalCost: { type: 'number' },
  },
} as const;

export const toolCallLogSchema = {
  type: 'object',
  properties: {
    toolName: { type: 'string' },
    args: { type: 'object' },
    result: { type: 'string' },
    durationMs: { type: 'number' },
  },
} as const;

export const executionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    scheduleId: { type: 'string' },
    scheduleName: { type: 'string' },
    userId: { type: 'string' },
    status: { type: 'string', enum: ['running', 'success', 'failure', 'skipped'] },
    trigger: { type: 'string', enum: ['scheduled', 'manual'] },
    startedAt: { type: 'string', format: 'date-time' },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    durationMs: { type: ['number', 'null'] },
    toolCalls: { type: 'array', items: toolCallLogSchema },
    agentResponse: { type: ['string', 'null'] },
    tokenUsage: tokenUsageSchema,
    error: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;
