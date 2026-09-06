import { PubSub } from '@google-cloud/pubsub';
import { buildExpectedDrainTopology } from './topology.mjs';

const clients = new Map();

function clientFor(projectId) {
  const existing = clients.get(projectId);
  if (existing) return existing;
  const client = new PubSub({ projectId });
  clients.set(projectId, client);
  return client;
}

try {
  for (const tuple of buildExpectedDrainTopology(process.env)) {
    const topic = clientFor(tuple.projectId).topic(tuple.topicName);
    const [topicExists] = await topic.exists();
    if (!topicExists) await topic.create();
    const subscription = topic.subscription(tuple.subscriptionName);
    const [subscriptionExists] = await subscription.exists();
    if (!subscriptionExists) await subscription.create();
  }
} finally {
  await Promise.all(
    [...clients.values()].map(async (client) => {
      await client.close();
    })
  );
}

console.log('[PubSub Bootstrap] Required local topics and monitor subscriptions are ready');
