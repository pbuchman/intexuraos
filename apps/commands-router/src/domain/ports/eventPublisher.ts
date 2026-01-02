import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../events/actionCreatedEvent.js';

export type { PublishError };

export interface EventPublisherPort {
  publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>>;
}
