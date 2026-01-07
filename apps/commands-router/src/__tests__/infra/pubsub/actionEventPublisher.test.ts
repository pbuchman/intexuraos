import { LlmModels } from '@intexuraos/llm-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionEventPublisher } from '../../../infra/pubsub/actionEventPublisher.js';
import type { ActionCreatedEvent } from '../../../domain/events/actionCreatedEvent.js';

const mockPublishToTopic = vi.fn();

vi.mock('@intexuraos/infra-pubsub', () => ({
  BasePubSubPublisher: class {
    protected projectId: string;
    protected loggerName: string;

    constructor(config: { projectId: string; loggerName?: string }) {
      this.projectId = config.projectId;
      this.loggerName = config.loggerName ?? 'test';
    }

    async publishToTopic(
      topicName: string | null,
      data: unknown,
      attributes: Record<string, string>,
      _description: string
    ): Promise<
      { ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }
    > {
      return mockPublishToTopic(topicName, data, attributes);
    }
  },
}));

describe('ActionEventPublisher', () => {
  let publisher: ActionEventPublisher;

  beforeEach(() => {
    mockPublishToTopic.mockReset();
    mockPublishToTopic.mockResolvedValue({ ok: true, value: undefined });
    process.env['INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC'] = 'test-research-topic';
    publisher = new ActionEventPublisher({ projectId: 'test-project' });
  });

  afterEach(() => {
    delete process.env['INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC'];
    vi.clearAllMocks();
  });

  describe('publishActionCreated', () => {
    it('publishes research action event successfully', async () => {
      const event: ActionCreatedEvent = {
        type: 'action.created',
        actionId: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        actionType: 'research',
        title: 'Research AI trends',
        payload: {
          prompt: 'What are the latest AI trends?',
          confidence: 0.95,
          selectedModels: [LlmModels.Gemini25Pro, LlmModels.ClaudeOpus45],
        },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const result = await publisher.publishActionCreated(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith('test-research-topic', event, {
        actionId: 'action-123',
        actionType: 'research',
      });
    });

    it('skips publish for action types without configured topic', async () => {
      const event: ActionCreatedEvent = {
        type: 'action.created',
        actionId: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        actionType: 'todo',
        title: 'Buy groceries',
        payload: {
          prompt: 'Buy groceries tomorrow',
          confidence: 0.9,
        },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const result = await publisher.publishActionCreated(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith(null, event, {
        actionId: 'action-123',
        actionType: 'todo',
      });
    });

    it('skips publish for note action type', async () => {
      const event: ActionCreatedEvent = {
        type: 'action.created',
        actionId: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        actionType: 'note',
        title: 'Meeting notes',
        payload: {
          prompt: 'Meeting notes from today',
          confidence: 0.85,
        },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const result = await publisher.publishActionCreated(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalledWith(null, event, {
        actionId: 'action-123',
        actionType: 'note',
      });
    });

    it('returns error when publish fails', async () => {
      mockPublishToTopic.mockResolvedValue({
        ok: false,
        error: { code: 'PUBLISH_FAILED', message: 'Pub/Sub unavailable' },
      });

      const event: ActionCreatedEvent = {
        type: 'action.created',
        actionId: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        actionType: 'research',
        title: 'Research topic',
        payload: {
          prompt: 'Research this topic',
          confidence: 0.9,
        },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const result = await publisher.publishActionCreated(event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PUBLISH_FAILED');
        expect(result.error.message).toContain('Pub/Sub unavailable');
      }
    });

    it('includes selectedModels in event data', async () => {
      const event: ActionCreatedEvent = {
        type: 'action.created',
        actionId: 'action-456',
        userId: 'user-789',
        commandId: 'cmd-123',
        actionType: 'research',
        title: 'Multi-model research',
        payload: {
          prompt: 'Compare AI models',
          confidence: 0.92,
          selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch, LlmModels.ClaudeOpus45],
        },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const result = await publisher.publishActionCreated(event);

      expect(result.ok).toBe(true);
      expect(mockPublishToTopic).toHaveBeenCalled();

      const [, publishedData] = mockPublishToTopic.mock.calls[0] as [string, ActionCreatedEvent];
      expect(publishedData.payload.selectedModels).toEqual([
        LlmModels.Gemini25Pro,
        LlmModels.O4MiniDeepResearch,
        LlmModels.ClaudeOpus45,
      ]);
    });
  });
});
