/**
 * Domain models for data insights.
 */

/**
 * Raw analytics event from a service.
 */
export interface AnalyticsEvent {
  /** Unique event ID */
  id: string;
  /** User ID this event belongs to */
  userId: string;
  /** Service that generated this event */
  sourceService: string;
  /** Event type (e.g., "message_sent", "prompt_used") */
  eventType: string;
  /** Event payload (service-specific) */
  payload: Record<string, unknown>;
  /** When the event occurred */
  timestamp: Date;
  /** When the event was recorded */
  createdAt: Date;
}

/**
 * Aggregated insights for a user.
 */
export interface AggregatedInsights {
  /** User ID */
  userId: string;
  /** Summary statistics */
  summary: InsightsSummary;
  /** Usage statistics by service */
  usageByService: Record<string, ServiceUsage>;
  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * Summary of insights for a user.
 */
export interface InsightsSummary {
  /** Total events recorded */
  totalEvents: number;
  /** Total events in last 7 days */
  eventsLast7Days: number;
  /** Total events in last 30 days */
  eventsLast30Days: number;
  /** Most active service */
  mostActiveService: string | null;
}

/**
 * Usage statistics for a specific service.
 */
export interface ServiceUsage {
  /** Service name */
  serviceName: string;
  /** Total events from this service */
  totalEvents: number;
  /** Events in last 7 days */
  eventsLast7Days: number;
  /** Last event timestamp */
  lastEventAt: Date | null;
}

/**
 * Request to create an analytics event.
 */
export interface CreateAnalyticsEventRequest {
  userId: string;
  sourceService: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp?: Date;
}
