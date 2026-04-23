/**
 * PR Triage Publisher.
 *
 * Publishes PRTriageEvent so a Pub/Sub push subscription can run
 * code-agent's unifiedEvaluator inside its own request lifetime
 * (avoiding webhook fire-and-forget being killed by Cloud Run CPU
 * throttling or revision rollovers).
 */
import { type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher } from './basePublisher.js';
import type { PublishError, PRTriageEvent, PRTriagePublisherConfig } from './types.js';

export interface PRTriagePublisher {
  publishPRTriage(params: {
    eventId: string;
    repository: string;
    pullRequestNumber: number;
    correlationId: string;
  }): Promise<Result<void, PublishError>>;
}

class PRTriagePublisherImpl extends BasePubSubPublisher implements PRTriagePublisher {
  private readonly topicName: string;

  constructor(config: PRTriagePublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publishPRTriage(params: {
    eventId: string;
    repository: string;
    pullRequestNumber: number;
    correlationId: string;
  }): Promise<Result<void, PublishError>> {
    const event: PRTriageEvent = {
      type: 'code.pr.triage.requested',
      eventId: params.eventId,
      repository: params.repository,
      pullRequestNumber: params.pullRequestNumber,
      correlationId: params.correlationId,
      timestamp: new Date().toISOString(),
    };

    return await this.publishToOptionalTopic(
      this.topicName === '' ? null : this.topicName,
      event,
      {
        correlationId: params.correlationId,
        eventId: params.eventId,
        repository: params.repository,
        prNumber: params.pullRequestNumber,
      },
      'PR triage request'
    );
  }
}

export function createPRTriagePublisher(config: PRTriagePublisherConfig): PRTriagePublisher {
  return new PRTriagePublisherImpl(config);
}
