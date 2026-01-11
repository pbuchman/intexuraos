/**
 * Get the unified actions queue topic name.
 * All action types are published to a single queue.
 */
export function getActionsQueueTopic(): string | null {
  const topic = process.env['INTEXURAOS_PUBSUB_ACTIONS_QUEUE'];
  return topic !== undefined && topic !== '' ? topic : null;
}
