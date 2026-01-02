import type { ActionType } from '../../domain/models/action.js';

/**
 * Get topic name for action type from environment variables.
 * Returns null if no topic is configured for the action type.
 */
export function getTopicForActionType(actionType: ActionType): string | null {
  const topicMap: Record<ActionType, string | undefined> = {
    research: process.env['INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC'],
    todo: process.env['INTEXURAOS_PUBSUB_ACTIONS_TODO_TOPIC'],
    note: process.env['INTEXURAOS_PUBSUB_ACTIONS_NOTE_TOPIC'],
    link: process.env['INTEXURAOS_PUBSUB_ACTIONS_LINK_TOPIC'],
    calendar: process.env['INTEXURAOS_PUBSUB_ACTIONS_CALENDAR_TOPIC'],
    reminder: process.env['INTEXURAOS_PUBSUB_ACTIONS_REMINDER_TOPIC'],
  };

  const topic = topicMap[actionType];
  return topic !== undefined && topic !== '' ? topic : null;
}
