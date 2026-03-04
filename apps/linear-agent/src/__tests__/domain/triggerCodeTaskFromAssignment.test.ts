import { describe, expect, it } from 'vitest';
import { shouldTriggerCodeTask, triggerCodeTaskFromAssignment } from '../../domain/useCases/triggerCodeTaskFromAssignment.js';
import type { LinearWebhookEvent } from '../../domain/webhookTypes.js';
import { FakeCodeAgentClient } from '../fakes.js';
import { createFakeLogger } from '../testUtils.js';

function createEvent(overrides: Partial<LinearWebhookEvent> = {}): LinearWebhookEvent {
  return {
    action: 'update',
    type: 'Issue',
    data: {
      id: 'issue-uuid-1',
      identifier: 'INT-123',
      title: 'Test Issue',
      description: 'Implement the feature',
      priority: 2,
      url: 'https://linear.app/team/issue/INT-123',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      state: { id: 'state-1', name: 'Todo', type: 'unstarted' },
      assignee: { id: 'user-1', name: 'Test User' },
      labels: [{ id: 'label-1', name: 'bug' }],
      team: { id: 'team-1', key: 'INT' },
    },
    updatedFrom: { assigneeId: null },
    webhookTimestamp: Date.now(),
    webhookId: 'webhook-1',
    ...overrides,
  };
}

describe('shouldTriggerCodeTask', () => {
  it('returns true for new assignment in unstarted state without Code Task label', () => {
    expect(shouldTriggerCodeTask(createEvent())).toBe(true);
  });

  it('returns false when action is not update', () => {
    expect(shouldTriggerCodeTask(createEvent({ action: 'create' }))).toBe(false);
    expect(shouldTriggerCodeTask(createEvent({ action: 'remove' }))).toBe(false);
  });

  it('returns false when updatedFrom is undefined', () => {
    const { updatedFrom: _, ...rest } = createEvent();
    expect(shouldTriggerCodeTask(rest as LinearWebhookEvent)).toBe(false);
  });

  it('returns false when previous assignee was not null (reassignment)', () => {
    expect(shouldTriggerCodeTask(createEvent({ updatedFrom: { assigneeId: 'prev-user' } }))).toBe(false);
  });

  it('returns false when updatedFrom has no assigneeId field', () => {
    expect(shouldTriggerCodeTask(createEvent({ updatedFrom: { stateId: 'some-state' } }))).toBe(false);
  });

  it('returns false when current assignee is null', () => {
    const event = createEvent();
    event.data.assignee = null;
    expect(shouldTriggerCodeTask(event)).toBe(false);
  });

  it('returns false when state is not backlog or unstarted', () => {
    const event = createEvent();
    event.data.state = { id: 'state-2', name: 'In Progress', type: 'started' };
    expect(shouldTriggerCodeTask(event)).toBe(false);
  });

  it('returns true for backlog state', () => {
    const event = createEvent();
    event.data.state = { id: 'state-backlog', name: 'Backlog', type: 'backlog' };
    expect(shouldTriggerCodeTask(event)).toBe(true);
  });
});

describe('triggerCodeTaskFromAssignment', () => {
  it('sends correct request to code-agent client without code-task label', async () => {
    const client = new FakeCodeAgentClient();
    const logger = createFakeLogger();

    await triggerCodeTaskFromAssignment(createEvent(), 'user-123', {
      codeAgentClient: client,
      logger,
    });

    const req = client.getLastRequest();
    expect(req).not.toBeNull();
    expect(req?.userId).toBe('user-123');
    expect(req?.linearIssueId).toBe('INT-123');
    expect(req?.prompt).toBe('Analyze the linked Linear issue and all its comments (newest first). Enrich the description with requirements, acceptance criteria, and test plan. Then mark it ready for execution or flag it as unclear.');
    expect(req?.workerType).toBe('auto');
  });

  it('uses EXECUTION_PROMPT when issue has code-task label', async () => {
    const client = new FakeCodeAgentClient();
    const logger = createFakeLogger();

    const event = createEvent({
      data: {
        ...createEvent().data,
        labels: [{ id: 'label-code', name: 'code-task' }],
      },
    });

    await triggerCodeTaskFromAssignment(event, 'user-123', {
      codeAgentClient: client,
      logger,
    });

    const req = client.getLastRequest();
    expect(req).not.toBeNull();
    expect(req?.prompt).toBe('Implement the requirements defined in the linked Linear issue and its comments (newest first). Follow the test plan, write code, run CI, and create a PR.');
  });

  it('uses identifier and timestamp for actionId and approvalEventId deduplication', async () => {
    const client = new FakeCodeAgentClient();
    const logger = createFakeLogger();
    const timestamp = 1706291940000;

    await triggerCodeTaskFromAssignment(
      createEvent({ webhookTimestamp: timestamp }),
      'user-123',
      { codeAgentClient: client, logger }
    );

    const req = client.getLastRequest();
    expect(req).not.toBeNull();
    expect(req?.actionId).toBe(`webhook-assign-INT-123-${String(timestamp)}`);
    expect(req?.approvalEventId).toBe(`webhook-assign-INT-123-${String(timestamp)}`);
  });

  it('does not throw on successful trigger', async () => {
    const client = new FakeCodeAgentClient();
    const logger = createFakeLogger();

    await expect(
      triggerCodeTaskFromAssignment(createEvent(), 'user-123', {
        codeAgentClient: client,
        logger,
      })
    ).resolves.toBeUndefined();

    expect(client.getLastRequest()).not.toBeNull();
  });

  it('does not throw on failed trigger', async () => {
    const client = new FakeCodeAgentClient();
    client.setFailure(true, { code: 'UNAVAILABLE', message: 'down' });
    const logger = createFakeLogger();

    await expect(
      triggerCodeTaskFromAssignment(createEvent(), 'user-123', {
        codeAgentClient: client,
        logger,
      })
    ).resolves.toBeUndefined();

    expect(client.getLastRequest()).not.toBeNull();
  });
});
