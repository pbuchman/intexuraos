import type { Result } from '@intexuraos/common-core';
import type { ActionCreatedEvent } from '../events/actionCreatedEvent.js';

export interface PublishError {
  code: 'PUBLISH_FAILED';
  message: string;
}

export interface EventPublisherPort {
  publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>>;
}
