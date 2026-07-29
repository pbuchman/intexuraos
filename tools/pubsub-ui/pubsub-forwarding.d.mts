export interface LocalPubSubMessage {
  data: Buffer;
  id: string;
  publishTime: string | Date;
}

export interface LocalPubSubPushEnvelope {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export function createPubSubPushEnvelope(
  topicName: string,
  message: LocalPubSubMessage
): LocalPubSubPushEnvelope;

export function resolvePubSubProjectId(
  topicName: string,
  environment?: Readonly<Record<string, string | undefined>>
): string;

export function resolvePubSubProjectIds(
  topicName: string,
  environment?: Readonly<Record<string, string | undefined>>
): string[];
