import { describe, expect, it } from 'vitest';
import { CreateTaskRequestSchema } from '../types/schemas.js';

describe('CreateTaskRequestSchema', () => {
  it('accepts executionMemoryContext for execution tasks', () => {
    const executionMemoryContext = {
      applicationId: 'app_123',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Callback logging, route verification, and env propagation.',
      matchedMemories: [
        {
          memoryId: 'mem_142',
          title: 'Log incoming requests on callback routes',
          memoryType: 'pitfall_pattern',
          score: 0.94,
          appliesWhen: 'A callback route changes request handling.',
          action: 'Update request logging with the route change.',
          avoid: 'Do not copy stale branch names from memories.',
          verification: 'Add app.inject coverage for the route.',
        },
      ],
    };

    const result = CreateTaskRequestSchema.safeParse({
      taskId: 'task-memory-context',
      workerType: 'auto',
      prompt: 'Fix callback logging and route coverage',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      linearIssueLabels: ['code-task'],
      hasChildren: false,
      agentType: 'execution',
      executionMemoryContext,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.executionMemoryContext).toEqual(executionMemoryContext);
  });
});
