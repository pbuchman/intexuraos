/**
 * Port for recording PR automation lifecycle events.
 *
 * The domain layer emits typed events at each decision point.
 * The infrastructure layer decides how to render and deliver them
 * (e.g., as a single append-only GitHub PR comment).
 */

export interface PRRef {
  repository: string; // e.g., "pbuchman/intexuraos"
  prNumber: number;
}

export type AutomationEvent =
  // Phase 1: Webhook arrival
  | {
      type: 'webhook_received';
      eventType: string; // e.g., "pull_request"
      action: string; // e.g., "opened"
      sender: string; // GitHub login
      deliveryId: string; // X-GitHub-Delivery header
      eventUrl?: string; // html_url from the GitHub webhook payload
      summary?: string; // Short human-readable preview of the event content
    }

  // Phase 2: Decision -- skip
  | {
      type: 'skipped';
      decidedBy: 'webhook_route' | 'hard_rules' | 'llm_triage';
      reason: string; // e.g., "PROTECTED_BASE_BRANCH"
      ruleName?: string; // e.g., "ProtectedBaseBranchRule"
      cost?: number; // LLM cost in USD (llm_triage only)
      reasoning?: string; // LLM reasoning (llm_triage only)
      toolCalls?: string[]; // Deduplicated tool call summaries
    }

  // Phase 3: Decision -- dispatch via LLM triage
  | {
      type: 'triage_dispatch';
      reviewTypes?: string[]; // e.g., ["code_review", "architecture"]
      workerType?: string; // e.g., "opus"
      cost: number;
      reasoning: string;
      toolCalls: string[];
    }

  // Phase 3b: Triage failure
  | {
      type: 'triage_failed';
      error: string;
      fallbackAction: 'dispatch' | 'skip' | 'none';
    }

  // Phase 4: Task dispatch
  | {
      type: 'task_dispatched';
      taskId: string;
      workerType: string;
      agentType: 'planning' | 'execution' | 'review' | 'pull_request';
      linearIssueId?: string;
    }
  | {
      type: 'task_dispatch_failed';
      error: string;
      errorCode?: string;
    }

  // Phase 4b: Linear issue linking failure (best-effort, non-blocking)
  | {
      type: 'linear_issue_failed';
      error: string;
    }

  // Phase 5: Task lifecycle (from orchestrator via task-event endpoint)
  | {
      type: 'task_started';
      taskId: string;
      workerType: string;
      attempt: number;
    }
  | {
      type: 'task_completed';
      taskId: string;
      status: 'implemented' | 'reviewed' | 'planned' | 'unknown';
      duration: number; // milliseconds
      prUrl?: string;
      commits?: { sha: string; message: string }[];
    }
  | {
      type: 'task_failed';
      taskId: string;
      error: string;
      errorCode?: string;
      duration?: number;
    }
  | {
      type: 'task_interrupted';
      taskId: string;
      duration?: number;
    }

  // Phase 6: Review lifecycle
  | {
      type: 'review_replaced';
      replacedTaskId: string;
      replacedWorkerType?: string;
    };

export interface AutomationLog {
  record(prRef: PRRef, event: AutomationEvent, tokenUserId?: string): Promise<void>;
}
