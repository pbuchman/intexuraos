import type {
  WebhookAgentDecision,
  WebhookActionPlan,
  ActionStep,
  DecisionKind,
} from './models.js';

export interface ActionCompilerInput {
  runId: string;
  decision: WebhookAgentDecision;
  hasExistingTask: boolean;
  userMapped: boolean;
  ownsProcessingMarker: boolean;
}

function makeActionId(runId: string, type: string, index: number): string {
  return `${runId}-${type}-${String(index)}`;
}

function compileNoopPlan(): WebhookActionPlan {
  return { version: '1.0', decisionKind: 'noop', actions: [] };
}

function compileSendTaskMessagePlan(runId: string): WebhookActionPlan {
  const actions: ActionStep[] = [
    {
      actionId: makeActionId(runId, 'send', 0),
      type: 'send_task_message',
      params: {},
    },
  ];
  return { version: '1.0', decisionKind: 'send_task_message', actions };
}

function compileCreatePrCommentTaskPlan(
  runId: string,
  decision: WebhookAgentDecision,
  ownsMarker: boolean
): WebhookActionPlan {
  const actions: ActionStep[] = [];
  let index = 0;

  if (ownsMarker) {
    actions.push({
      actionId: makeActionId(runId, 'mark', index),
      type: 'mark_processing',
      params: {},
    });
    index++;
  }

  actions.push({
    actionId: makeActionId(runId, 'dispatch', index),
    type: 'dispatch_task',
    params: {
      workerType: decision.requestedWorkerType,
    },
  });

  return { version: '1.0', decisionKind: 'create_pr_comment_task', actions };
}

function compileCreateCodeActionPlan(
  runId: string,
  decision: WebhookAgentDecision,
  ownsMarker: boolean
): WebhookActionPlan {
  const actions: ActionStep[] = [];
  let index = 0;

  if (ownsMarker) {
    actions.push({
      actionId: makeActionId(runId, 'mark', index),
      type: 'mark_processing',
      params: {},
    });
    index++;
  }

  actions.push({
    actionId: makeActionId(runId, 'dispatch', index),
    type: 'dispatch_task',
    params: {
      workerType: decision.requestedWorkerType,
    },
  });
  index++;

  actions.push({
    actionId: makeActionId(runId, 'notify', index),
    type: 'notify_chat',
    params: {},
  });

  return { version: '1.0', decisionKind: 'create_code_action', actions };
}

const COMPILERS: Record<
  DecisionKind,
  (runId: string, decision: WebhookAgentDecision, ownsMarker: boolean) => WebhookActionPlan
> = {
  noop: () => compileNoopPlan(),
  send_task_message: (runId) => compileSendTaskMessagePlan(runId),
  create_pr_comment_task: (runId, decision, ownsMarker) => compileCreatePrCommentTaskPlan(runId, decision, ownsMarker),
  create_code_action: (runId, decision, ownsMarker) => compileCreateCodeActionPlan(runId, decision, ownsMarker),
};

export function compileWebhookActionPlan(input: ActionCompilerInput): WebhookActionPlan {
  const kind = input.decision.decision.kind;
  const compiler = COMPILERS[kind];
  return compiler(input.runId, input.decision, input.ownsProcessingMarker);
}
