/**
 * Types for the PR-triage Pub/Sub client.
 */
import type { Logger } from 'pino';

/**
 * Event published when a GitHub PR webhook event has been persisted to
 * Firestore and needs unified evaluation (hard rules + LLM triage).
 *
 * The event carries only the Firestore eventId — the push subscription
 * handler reloads the full GitHubPREvent from `github-pr-events`. This
 * keeps the message small and avoids serialization drift.
 */
export interface PRTriageEvent {
  /**
   * Event type identifier.
   */
  type: 'code.pr.triage.requested';

  /**
   * Firestore document ID of the saved github-pr-events record.
   */
  eventId: string;

  /**
   * Repository for logging / dedup; reload from Firestore is the source of truth.
   */
  repository: string;

  /**
   * PR number for logging.
   */
  pullRequestNumber: number;

  /**
   * Correlation ID for tracing across services.
   */
  correlationId: string;

  /**
   * Event timestamp (ISO 8601).
   */
  timestamp: string;
}

/**
 * Configuration for the PR triage publisher.
 */
export interface PRTriagePublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}
