import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTopicForActionType } from '../infra/pubsub/config.js';

describe('getTopicForActionType', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns topic for research action type', () => {
    process.env['INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC'] = 'projects/test/topics/research';

    const result = getTopicForActionType('research');

    expect(result).toBe('projects/test/topics/research');
  });

  it('returns null when topic is not configured', () => {
    delete process.env['INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC'];

    const result = getTopicForActionType('research');

    expect(result).toBeNull();
  });

  it('returns null when topic is empty string', () => {
    process.env['INTEXURAOS_PUBSUB_ACTIONS_TODO_TOPIC'] = '';

    const result = getTopicForActionType('todo');

    expect(result).toBeNull();
  });

  it('returns topic for each action type', () => {
    process.env['INTEXURAOS_PUBSUB_ACTIONS_NOTE_TOPIC'] = 'note-topic';
    process.env['INTEXURAOS_PUBSUB_ACTIONS_LINK_TOPIC'] = 'link-topic';
    process.env['INTEXURAOS_PUBSUB_ACTIONS_CALENDAR_TOPIC'] = 'calendar-topic';
    process.env['INTEXURAOS_PUBSUB_ACTIONS_REMINDER_TOPIC'] = 'reminder-topic';

    expect(getTopicForActionType('note')).toBe('note-topic');
    expect(getTopicForActionType('link')).toBe('link-topic');
    expect(getTopicForActionType('calendar')).toBe('calendar-topic');
    expect(getTopicForActionType('reminder')).toBe('reminder-topic');
  });
});
