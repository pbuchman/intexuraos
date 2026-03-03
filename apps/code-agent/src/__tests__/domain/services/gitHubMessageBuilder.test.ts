import { GitHubMessageBuilder, PullRequestReviewTemplate, IssueCommentTemplate, EditedBotReviewTemplate, GenericCommentTemplate } from '../../../domain/services/gitHubMessageBuilder.js';
import type { GitHubPREvent, GitHubEventType } from '../../../domain/models/gitHubPREvent.js';
import type { TaskContext } from '../../../domain/services/gitHubMessageBuilder.js';
import { describe, it, expect } from 'vitest';

// Mock event data
const mockPRReviewEvent: GitHubPREvent = {
  id: 'event-123',
  githubEventId: 123,
  repository: 'test/repo',
  repositoryId: 54321,
  pullRequestNumber: 123,
  pullRequestId: 12345,
  eventType: 'pull_request_review',
  action: 'submitted',
  senderLogin: 'test-user',
  senderId: 999,
  senderType: 'User',
  title: 'Test PR',
  body: 'This is a review comment',
  state: 'open',
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {
    review: {
      id: 456,
      state: 'approved'
    }
  }
};

const mockIssueCommentEvent: GitHubPREvent = {
  id: 'event-124',
  githubEventId: 124,
  repository: 'test/repo',
  repositoryId: 54321,
  pullRequestNumber: 123,
  pullRequestId: 12345,
  eventType: 'issue_comment',
  action: 'created',
  senderLogin: 'test-user',
  senderId: 999,
  senderType: 'User',
  title: 'Test PR',
  body: 'This is an issue comment',
  state: 'open',
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {}
};

const mockEditedBotReviewEvent: GitHubPREvent = {
  id: 'event-125',
  githubEventId: 125,
  repository: 'test/repo',
  repositoryId: 54321,
  pullRequestNumber: 123,
  pullRequestId: 12345,
  eventType: 'pull_request_review',
  action: 'edited',
  senderLogin: 'test-user',
  senderId: 999,
  senderType: 'User',
  title: 'Test PR',
  body: 'This is an edited bot review',
  state: 'open',
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {}
};

const mockGenericEvent: GitHubPREvent = {
  id: 'event-126',
  githubEventId: 126,
  repository: 'test/repo',
  repositoryId: 54321,
  pullRequestNumber: 123,
  pullRequestId: 12345,
  eventType: 'unknown_event' as GitHubEventType,
  action: 'opened',
  senderLogin: 'test-user',
  senderId: 999,
  senderType: 'User',
  title: 'Test PR',
  body: 'This is a generic event',
  state: 'open',
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {}
};

const mockTaskContext: TaskContext = {
  taskId: 'task-123',
  userId: 'user-456'
};

describe('GitHubMessageBuilder', () => {
  describe('PullRequestReviewTemplate', () => {
    it('renders pull request review events correctly', () => {
      const template = new PullRequestReviewTemplate();
      const result = template.render(mockPRReviewEvent, mockTaskContext);

      expect(result).toContain('GitHub Pull Request Review');
      expect(result).toContain('Repository: test/repo');
      expect(result).toContain('PR #123');
      expect(result).toContain('Sender: test-user');
      expect(result).toContain('Review ID: 456');
      expect(result).toContain('Review State: approved');
      expect(result).toContain('This is a review comment');
      expect(result).toContain('Task ID: task-123');
      expect(result).toContain('User ID: user-456');
    });

    it('handles missing review payload gracefully', () => {
      const eventWithMissingPayload: GitHubPREvent = {
        ...mockPRReviewEvent,
        payload: {}
      };

      const template = new PullRequestReviewTemplate();
      const result = template.render(eventWithMissingPayload, mockTaskContext);

      expect(result).toContain('Review ID: unknown');
      expect(result).toContain('Review State: unknown');
    });

    it('handles null body gracefully', () => {
      const eventWithNullBody: GitHubPREvent = {
        ...mockPRReviewEvent,
        body: null as unknown as string
      };

      const template = new PullRequestReviewTemplate();
      const result = template.render(eventWithNullBody, mockTaskContext);

      expect(result).toContain('(No review comment provided)');
    });

    it('handles review with non-object review field', () => {
      const event: GitHubPREvent = {
        ...mockPRReviewEvent,
        payload: { review: 'not-an-object' }
      };

      const template = new PullRequestReviewTemplate();
      const result = template.render(event, mockTaskContext);

      expect(result).toContain('Review ID: unknown');
      expect(result).toContain('Review State: unknown');
    });

    it('handles review with non-standard id and state types', () => {
      const event: GitHubPREvent = {
        ...mockPRReviewEvent,
        payload: { review: { id: true, state: 42 } }
      };

      const template = new PullRequestReviewTemplate();
      const result = template.render(event, mockTaskContext);

      expect(result).toContain('Review ID: unknown');
      expect(result).toContain('Review State: unknown');
    });

    it('handles missing context gracefully', () => {
      const template = new PullRequestReviewTemplate();
      const result = template.render(mockPRReviewEvent, undefined);

      expect(result).toContain('Task ID: unknown');
      expect(result).toContain('User ID: unknown');
    });
  });

  describe('IssueCommentTemplate', () => {
    it('renders issue comment events correctly', () => {
      const template = new IssueCommentTemplate();
      const result = template.render(mockIssueCommentEvent, mockTaskContext);

      expect(result).toContain('GitHub Issue Comment');
      expect(result).toContain('Repository: test/repo');
      expect(result).toContain('PR #123');
      expect(result).toContain('Sender: test-user');
      expect(result).toContain('This is an issue comment');
      expect(result).toContain('Task ID: task-123');
      expect(result).toContain('User ID: user-456');
    });

    it('handles null body gracefully', () => {
      const eventWithNullBody: GitHubPREvent = {
        ...mockIssueCommentEvent,
        body: null as unknown as string
      };

      const template = new IssueCommentTemplate();
      const result = template.render(eventWithNullBody, mockTaskContext);

      expect(result).toContain('(No comment provided)');
    });

    it('handles missing context gracefully', () => {
      const template = new IssueCommentTemplate();
      const result = template.render(mockIssueCommentEvent, undefined);

      expect(result).toContain('Task ID: unknown');
      expect(result).toContain('User ID: unknown');
    });
  });

  describe('EditedBotReviewTemplate', () => {
    it('renders edited bot review events correctly', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotReviewEvent, mockTaskContext);

      expect(result).toContain('GitHub Edited Bot Review');
      expect(result).toContain('Repository: test/repo');
      expect(result).toContain('PR #123');
      expect(result).toContain('Sender: test-user');
      expect(result).toContain('This is an edited bot review');
      expect(result).toContain('Task ID: task-123');
      expect(result).toContain('User ID: user-456');
      expect(result).toContain('Special Instructions for Triage Table Updates');
    });

    it('handles null body gracefully', () => {
      const eventWithNullBody: GitHubPREvent = {
        ...mockEditedBotReviewEvent,
        body: null as unknown as string
      };

      const template = new EditedBotReviewTemplate();
      const result = template.render(eventWithNullBody, mockTaskContext);

      expect(result).toContain('(No review comment provided)');
    });

    it('handles missing context gracefully', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotReviewEvent, undefined);

      expect(result).toContain('Task ID: unknown');
      expect(result).toContain('User ID: unknown');
    });
  });

  describe('GenericCommentTemplate', () => {
    it('renders generic events correctly', () => {
      const template = new GenericCommentTemplate();
      const result = template.render(mockGenericEvent, mockTaskContext);

      expect(result).toContain('GitHub Event: unknown_event');
      expect(result).toContain('Repository: test/repo');
      expect(result).toContain('PR #123');
      expect(result).toContain('Sender: test-user');
      expect(result).toContain('This is a generic event');
      expect(result).toContain('Task ID: task-123');
      expect(result).toContain('User ID: user-456');
    });

    it('handles null body gracefully', () => {
      const eventWithNullBody: GitHubPREvent = {
        ...mockGenericEvent,
        body: null as unknown as string
      };

      const template = new GenericCommentTemplate();
      const result = template.render(eventWithNullBody, mockTaskContext);

      expect(result).toContain('(No content provided)');
    });

    it('handles missing context gracefully', () => {
      const template = new GenericCommentTemplate();
      const result = template.render(mockGenericEvent, undefined);

      expect(result).toContain('Task ID: unknown');
      expect(result).toContain('User ID: unknown');
    });
  });

  describe('GitHubMessageBuilder', () => {
    it('builds messages using registered templates', () => {
      const builder = new GitHubMessageBuilder();
      const result = builder.build(mockPRReviewEvent, mockTaskContext);

      expect(result).toContain('GitHub Pull Request Review');
      expect(result).toContain('Review ID: 456');
    });

    it('falls back to generic template for unregistered event types', () => {
      const builder = new GitHubMessageBuilder();
      const result = builder.build(mockGenericEvent, mockTaskContext);

      expect(result).toContain('GitHub Event: unknown_event');
    });

    it('allows custom template registration', () => {
      const builder = new GitHubMessageBuilder();
      const customTemplate = new GenericCommentTemplate();

      builder.registerTemplate('custom_event' as GitHubEventType, customTemplate);

      const customEvent: GitHubPREvent = {
        id: 'event-custom',
        githubEventId: 999,
        eventType: 'custom_event' as GitHubEventType,
        action: 'created',
        repository: 'test/repo',
        repositoryId: 54321,
        pullRequestNumber: 123,
        pullRequestId: 12345,
        senderLogin: 'test-user',
        senderId: 999,
        senderType: 'User',
        body: 'Custom event',
        title: 'Test PR',
        state: 'open',
        mergedAt: null,
        createdAt: new Date('2026-03-03T10:00:00Z'),
        processedAt: new Date('2026-03-03T10:00:00Z'),
        payload: {}
      };

      const result = builder.build(customEvent, mockTaskContext);
      expect(result).toContain('GitHub Event: custom_event');
    });

    it('returns all registered template types', () => {
      const builder = new GitHubMessageBuilder();
      const registeredTypes = builder.getRegisteredTemplateTypes();

      expect(registeredTypes).toContain('pull_request_review');
      expect(registeredTypes).toContain('issue_comment');
      expect(registeredTypes).toContain('edited_bot_review');
    });

    it('handles missing task context gracefully', () => {
      const builder = new GitHubMessageBuilder();
      const result = builder.build(mockPRReviewEvent, undefined as unknown as TaskContext);

      expect(result).toContain('Task ID: unknown');
      expect(result).toContain('User ID: unknown');
    });
  });

  // Snapshot tests
  describe('Snapshot Tests', () => {
    it('matches snapshot for pull request review', () => {
      const builder = new GitHubMessageBuilder();
      const result = builder.build(mockPRReviewEvent, mockTaskContext);
      expect(result).toMatchSnapshot();
    });

    it('matches snapshot for issue comment', () => {
      const builder = new GitHubMessageBuilder();
      const result = builder.build(mockIssueCommentEvent, mockTaskContext);
      expect(result).toMatchSnapshot();
    });

    it('matches snapshot for edited bot review', () => {
      const builder = new GitHubMessageBuilder();
      const result = builder.build(mockEditedBotReviewEvent, mockTaskContext);
      expect(result).toMatchSnapshot();
    });

    it('matches snapshot for generic event', () => {
      const builder = new GitHubMessageBuilder();
      const result = builder.build(mockGenericEvent, mockTaskContext);
      expect(result).toMatchSnapshot();
    });
  });
});