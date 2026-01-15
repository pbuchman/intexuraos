import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';

export interface ActionEventPublisher {
  publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>>;
}
