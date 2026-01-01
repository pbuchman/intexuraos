import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionEventPublisher } from '../../../infra/pubsub/actionEventPublisher.js';
import type { ActionCreatedEvent } from '../../../domain/events/actionCreatedEvent.js';

const mockPublishMessage = vi.fn();

vi.mock('@google-cloud/pubsub', () => {
  class MockTopic {
    publishMessage = mockPublishMessage;
  }

  class MockPubSub {
    topic(): MockTopic {
      return new MockTopic();
    }
  }

  return {
    PubSub: MockPubSub,
  };
});

describe('ActionEventPublisher', () => {
  let publisher: ActionEventPublisher;

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-123');
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
          selectedLlms: ['google', 'anthropic'],
        },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const result = await publisher.publishActionCreated(event);

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledWith({
        data: expect.any(Buffer) as Buffer,
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
      expect(mockPublishMessage).not.toHaveBeenCalled();
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
      expect(mockPublishMessage).not.toHaveBeenCalled();
    });

    it('returns error when publish fails', async () => {
      mockPublishMessage.mockRejectedValue(new Error('Pub/Sub unavailable'));

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

    it('includes selectedLlms in event data', async () => {
      const event: ActionCreatedEvent = {
        type: 'action.created',
        actionId: 'action-456',
        userId: 'user-789',
        commandId: 'cmd-123',
        actionType: 'research',
        title: 'Multi-LLM research',
        payload: {
          prompt: 'Compare AI models',
          confidence: 0.92,
          selectedLlms: ['google', 'openai', 'anthropic'],
        },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const result = await publisher.publishActionCreated(event);

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalled();

      const callArg = mockPublishMessage.mock.calls[0]?.[0] as { data: Buffer };
      const publishedData = JSON.parse(callArg.data.toString()) as ActionCreatedEvent;
      expect(publishedData.payload.selectedLlms).toEqual(['google', 'openai', 'anthropic']);
    });
  });
});
