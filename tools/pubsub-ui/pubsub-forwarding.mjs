const DEFAULT_PUBSUB_PROJECT_ID = 'demo-intexuraos';
const DEFAULT_MESSAGE_DIGEST_PUBSUB_PROJECT_ID = 'intexuraos-message-digest-mvp-local';

export function resolvePubSubProjectId(topicName, environment = {}) {
  const configuredDefault = environment.PUBSUB_PROJECT_ID?.trim();
  if (topicName !== 'message-digest-runs') {
    return configuredDefault || DEFAULT_PUBSUB_PROJECT_ID;
  }

  return (
    environment.MESSAGE_DIGEST_PUBSUB_PROJECT_ID?.trim() || DEFAULT_MESSAGE_DIGEST_PUBSUB_PROJECT_ID
  );
}

export function resolvePubSubProjectIds(topicName, environment = {}) {
  const primaryProjectId = resolvePubSubProjectId(topicName, environment);
  if (topicName !== 'whatsapp-send-message') return [primaryProjectId];

  const digestProjectId =
    environment.MESSAGE_DIGEST_PUBSUB_PROJECT_ID?.trim() ||
    DEFAULT_MESSAGE_DIGEST_PUBSUB_PROJECT_ID;
  return primaryProjectId === digestProjectId
    ? [primaryProjectId]
    : [primaryProjectId, digestProjectId];
}

export function createPubSubPushEnvelope(topicName, message) {
  return {
    message: {
      data: message.data.toString('base64'),
      messageId: message.id,
      publishTime:
        message.publishTime instanceof Date
          ? message.publishTime.toISOString()
          : message.publishTime,
    },
    subscription: `${topicName}-push`,
  };
}
