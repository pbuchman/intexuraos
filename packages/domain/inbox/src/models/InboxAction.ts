/**
 * Domain models for Inbox Actions.
 * Represents proposed/executed actions derived from inbox notes.
 */

/**
 * Status workflow for actions.
 */
export type InboxActionStatus = 'Proposed' | 'Needs approval' | 'Approved' | 'Rejected' | 'Executing' | 'Done' | 'Failed';

/**
 * Action operation types.
 */
export type InboxActionType = 'Create' | 'Update' | 'Move' | 'Delete' | 'Notify' | 'Enrich';

/**
 * Agent types that can handle actions.
 */
export type InboxActionAgent = 'TodoAgent' | 'KnowledgeAgent' | 'CalendarAgent' | 'PromptAgent' | 'FinanceAgent';

/**
 * Priority levels for actions.
 */
export type InboxActionPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

/**
 * Core domain entity for an Inbox Action.
 * This is the pure domain model - no Notion concepts here.
 */
export interface InboxAction {
  /**
   * Unique identifier (Notion page ID when persisted).
   */
  id?: string;

  /**
   * Action title.
   */
  title: string;

  /**
   * Current status in workflow.
   */
  status: InboxActionStatus;

  /**
   * Action operation type.
   */
  actionType: InboxActionType;

  /**
   * Agent responsible for handling this action.
   */
  agent: InboxActionAgent;

  /**
   * Priority level.
   */
  priority: InboxActionPriority;

  /**
   * Due date for action (optional).
   */
  dueDate?: Date;

  /**
   * Source note ID (Notion page ID).
   */
  sourceNoteId?: string;

  /**
   * JSON payload for action execution.
   */
  payload: string;

  /**
   * Execution log/history.
   */
  executionLog?: string;

  /**
   * Approval token for user confirmation.
   */
  approvalToken?: string;

  /**
   * External correlation ID (e.g., WhatsApp message ID).
   */
  externalCorrelationId?: string;

  /**
   * User WhatsApp identifier.
   */
  userWA?: string;

  /**
   * Whether to notify user.
   */
  userNotify: boolean;
}

/**
 * Parameters for creating a new inbox action.
 */
export interface CreateInboxActionParams {
  title: string;
  actionType: InboxActionType;
  agent: InboxActionAgent;
  payload: string;
  priority?: InboxActionPriority;
  status?: InboxActionStatus;
  dueDate?: Date;
  sourceNoteId?: string;
  userWA?: string;
  externalCorrelationId?: string;
  approvalToken?: string;
  userNotify?: boolean;
}

/**
 * Parameters for updating an inbox action.
 */
export interface UpdateInboxActionParams {
  id: string;
  status?: InboxActionStatus;
  executionLog?: string;
  payload?: string;
  dueDate?: Date;
}
