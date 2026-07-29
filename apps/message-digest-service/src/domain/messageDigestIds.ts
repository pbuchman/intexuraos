import { createHash } from 'node:crypto';

export function getMessageDigestDeliveryOutboxId(runId: string): string {
  const hash = createHash('sha256');
  for (const part of ['message-digest-whatsapp-delivery-outbox-v1', runId]) {
    hash.update(part.length.toString(10)).update(':').update(part);
  }
  return `mdo_${hash.digest('hex').slice(0, 48)}`;
}
