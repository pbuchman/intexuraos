/**
 * Port for Linear Agent API communication.
 * Wraps the Linear GraphQL API for agent activities and session management.
 */

import type { Result } from '@intexuraos/common-core';

export type ActivityType = 'thought' | 'action' | 'response' | 'error';

export interface EmitActivityRequest {
  sessionId: string;
  type: ActivityType;
  body: string;
}

export interface PlanStep {
  content: string;
  status: 'pending' | 'in-progress' | 'completed' | 'canceled';
}

export interface UpdateSessionPlanRequest {
  sessionId: string;
  plan: PlanStep[];
}

export interface UpdateSessionExternalUrlRequest {
  sessionId: string;
  externalUrls: { label: string; url: string }[];
}

export interface LinearAgentApiError {
  code: 'UNAVAILABLE' | 'UNAUTHORIZED' | 'INVALID_REQUEST' | 'UNKNOWN';
  message: string;
}

export interface LinearAgentApiClient {
  /**
   * Emit an activity to a Linear agent session.
   * Activities appear in the Linear UI as the agent's "thought process".
   */
  emitActivity(request: EmitActivityRequest): Promise<Result<void, LinearAgentApiError>>;

  /**
   * Update the plan (checklist) for an agent session.
   * Agent Plans appear as a checklist in the Linear UI.
   */
  updateSessionPlan(request: UpdateSessionPlanRequest): Promise<Result<void, LinearAgentApiError>>;

  /**
   * Add external URLs to an agent session (e.g., PR URLs).
   */
  updateSessionExternalUrls(request: UpdateSessionExternalUrlRequest): Promise<Result<void, LinearAgentApiError>>;
}
