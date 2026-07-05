import type { CodeTaskWorkerType as SharedCodeTaskWorkerType } from '@intexuraos/code-task-domain/worker-types';
import type { ConversationAssistantModel, LlmProvider } from '@intexuraos/llm-contract';
/**
 * API Response types matching backend response format.
 */

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  diagnostics?: {
    requestId: string;
    duration?: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  diagnostics?: {
    requestId: string;
    duration?: number;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * User info from /auth/me
 */
export interface UserInfo {
  userId: string;
  email?: string;
  name?: string;
  picture?: string;
  hasRefreshToken: boolean;
}

/**
 * Notion connection status from notion-service
 */
export interface NotionStatus {
  configured: boolean;
  connected: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Notion connect response
 */
export interface NotionConnectResponse {
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * WhatsApp connection status from whatsapp-service
 */
export interface WhatsAppStatus {
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * WhatsApp connect response
 */
export interface WhatsAppConnectResponse {
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * WhatsApp message media type
 */
export type WhatsAppMediaType = 'text' | 'image' | 'audio' | 'video';

/**
 * Transcription status for audio messages.
 */
export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Transcription error details
 */
export interface TranscriptionError {
  code: string;
  message: string;
}

/**
 * Link preview status for messages with URLs.
 */
export type LinkPreviewStatus = 'pending' | 'completed' | 'failed';

/**
 * Link preview data extracted from Open Graph metadata.
 */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
}

/**
 * Link preview error details
 */
export interface LinkPreviewError {
  code: string;
  message: string;
}

/**
 * Link preview state for messages
 */
export interface LinkPreviewState {
  status: LinkPreviewStatus;
  previews?: LinkPreview[];
  error?: LinkPreviewError;
}

/**
 * WhatsApp message from whatsapp-service
 */
export interface WhatsAppMessage {
  id: string;
  text: string;
  fromNumber: string;
  timestamp: string;
  receivedAt: string;
  mediaType: WhatsAppMediaType;
  hasMedia: boolean;
  caption: string | null;
  transcriptionStatus?: TranscriptionStatus;
  transcription?: string;
  transcriptionError?: TranscriptionError;
  linkPreview?: LinkPreviewState;
}

/**
 * WhatsApp messages list response
 */
export interface WhatsAppMessagesResponse {
  messages: WhatsAppMessage[];
  fromNumber: string | null;
  nextCursor?: string;
}

export type PrivateWhatsAppMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'sticker'
  | 'reaction'
  | 'redaction'
  | 'unknown';

export type PrivateWhatsAppDeliveryMode = 'live' | 'backfill';
export type PrivateWhatsAppTranscriptionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export interface PrivateWhatsAppMedia {
  mxcUri?: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  storageStatus?: 'stored';
  hasMedia?: boolean;
  hasThumbnail?: boolean;
  storedMimeType?: string;
  storedSizeBytes?: number;
  storedAt?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface PrivateWhatsAppTranscriptionError {
  code: string;
  message: string;
}

export interface PrivateWhatsAppTranscriptionState {
  status: PrivateWhatsAppTranscriptionStatus;
  jobId?: string;
  text?: string;
  summary?: string;
  detectedLanguage?: string;
  error?: PrivateWhatsAppTranscriptionError;
  startedAt?: string;
  completedAt?: string;
}

export interface PrivateWhatsAppReaction {
  id: string;
  emoji: string;
  senderKey?: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  direction: 'incoming' | 'outgoing';
  eventTimestamp: string;
}

export interface MediaUrlResponse {
  url: string;
  expiresAt: string;
}

export interface PrivateWhatsAppSender {
  id: string;
  senderKey: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  senderPhoneNumberNormalized?: string;
  firstEventAt: string;
  lastEventAt: string;
  messageCount: number;
  chatIds: string[];
  updatedAt: string;
  schemaVersion: number;
}

export interface PrivateWhatsAppChat {
  id: string;
  chatType: 'direct' | 'group' | 'unknown';
  displayName?: string;
  avatarMxcUri?: string;
  messageCount: number;
  participantCount: number;
  transcriptionEnabled?: boolean;
  transcriptionEnabledAt?: string;
  transcriptionUpdatedAt?: string;
  firstSeenAt: string;
  lastEventAt: string;
  updatedAt: string;
  schemaVersion?: number;
}

export interface PrivateWhatsAppMessage {
  id: string;
  chatId: string;
  senderKey?: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  senderPhoneNumberNormalized?: string;
  direction: 'incoming' | 'outgoing';
  messageType: PrivateWhatsAppMessageType;
  text?: string;
  media?: PrivateWhatsAppMedia;
  reaction?: {
    emoji: string;
    targetMessageId: string;
  };
  reactions?: PrivateWhatsAppReaction[];
  eventTimestamp: string;
  eventDayKey?: string;
  eventTimeZone?: string;
  chatDisplayName?: string;
  chatType?: string;
  receivedAt: string;
  ingestedAt: string;
  deliveryMode: PrivateWhatsAppDeliveryMode;
  transcription?: PrivateWhatsAppTranscriptionState;
  schemaVersion?: number;
}

export interface PrivateWhatsAppSenderDay {
  id: string;
  senderKey: string;
  eventDayKey: string;
  eventTimeZone: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  firstEventAt: string;
  lastEventAt: string;
  messageCount: number;
  messageTypeCounts: Record<string, number>;
  summaryStatus: 'not_started' | 'running' | 'completed' | 'failed';
  summaryText?: string;
  summaryGeneratedAt?: string;
  summarySourceMessageCount: number;
  updatedAt: string;
  schemaVersion: number;
}

export type PrivateWhatsAppAccountStatus = 'active' | 'disabled';

export interface PrivateWhatsAppAccount {
  phoneNumberNormalized: string;
  displayName: string;
  status: PrivateWhatsAppAccountStatus;
  createdAt: string;
  updatedAt: string;
  lastIngestAt?: string;
  lastEventAt?: string;
  messageCount?: number;
  senderCount?: number;
  schemaVersion: 1;
}

export interface PrivateWhatsAppSendersResponse {
  senders: PrivateWhatsAppSender[];
  nextCursor?: string;
}

export interface PrivateWhatsAppChatsResponse {
  chats: PrivateWhatsAppChat[];
  nextCursor?: string;
}

export interface PrivateWhatsAppMessagesResponse {
  messages: PrivateWhatsAppMessage[];
  nextCursor?: string;
}

export interface PrivateWhatsAppSenderDaysResponse {
  senderDays: PrivateWhatsAppSenderDay[];
  nextCursor?: string;
}

export type ConversationAssistantSessionStatus = 'active' | 'archived';

export interface ConversationAssistantOmittedCounts {
  mediaOnly: number;
  failedTranscriptions: number;
  pendingTranscriptions: number;
  nonText: number;
  overLimit: number;
}

export interface ConversationAssistantUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
}

export interface ConversationAssistantSession {
  id: string;
  userId: string;
  chatId: string;
  chatDisplayName?: string;
  status: ConversationAssistantSessionStatus;
  range: {
    from: string;
    to: string;
  };
  model: ConversationAssistantModel | string;
  modelDisplayName: string;
  transcriptSha256: string;
  transcriptMessageCount: number;
  omitted: ConversationAssistantOmittedCounts;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastTurnAt?: string;
}

export interface ConversationAssistantTurn {
  id: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  usage?: ConversationAssistantUsage;
  error?: {
    code: string;
    message: string;
  };
}

export interface ConversationAssistantSessionsResponse {
  sessions: ConversationAssistantSession[];
}

export interface ConversationAssistantTurnsResponse {
  turns: ConversationAssistantTurn[];
}

export interface ConversationAssistantPdfDownload {
  blob: Blob;
  filename: string;
}

export interface ConversationAssistantContextCheckRequest {
  chatId: string;
  from: string;
  to: string;
}

export interface ConversationAssistantContextCheckResponse {
  messageCount: number;
  warningThreshold: number;
  requiresConfirmation: boolean;
}

export interface CreateConversationAssistantSessionRequest {
  chatId: string;
  from: string;
  to: string;
  model?: ConversationAssistantModel;
  question?: string;
}

export interface SendConversationAssistantTurnRequest {
  question: string;
}

export type ConversationAssistantStreamEvent =
  | { type: 'user_turn'; turn: ConversationAssistantTurn }
  | { type: 'assistant_delta'; text: string }
  | { type: 'usage'; usage: ConversationAssistantUsage }
  | { type: 'error'; error: { code: string; message: string } }
  | { type: 'assistant_turn'; turn: ConversationAssistantTurn }
  | { type: 'done' };

export type IntexAgentSessionStatus =
  | 'active'
  | 'waiting_for_user'
  | 'executing_tool'
  | 'completed'
  | 'unsupported'
  | 'expired'
  | 'cancelled'
  | 'superseded';

export type IntexAgentSessionStartReason =
  | 'no_active_session'
  | 'previous_completed'
  | 'previous_expired'
  | 'user_requested_new_session'
  | 'previous_superseded';

export type IntexAgentSessionEndReason =
  | 'tool_completed'
  | 'tool_failed'
  | 'unsupported_request'
  | 'timeout'
  | 'cancelled_by_user'
  | 'superseded_by_user';

export type IntexAgentToolName =
  | 'create_note'
  | 'create_calendar_event'
  | 'query_calendar_events'
  | 'create_research'
  | 'create_link'
  | 'create_code_task'
  | 'save_external'
  | 'get_user_preferences'
  | 'add_user_preference'
  | 'update_user_preference'
  | 'delete_user_preference';

export interface IntexAgentSession {
  id: string;
  userId: string;
  channel: 'whatsapp';
  status: IntexAgentSessionStatus;
  startedAt: string;
  endedAt?: string;
  lastUserMessageAt: string;
  lastAssistantMessageAt?: string;
  startReason: IntexAgentSessionStartReason;
  endReason?: IntexAgentSessionEndReason;
  activeTool?: IntexAgentToolName;
  summary?: string;
}

export type IntexAgentSessionEventType =
  | 'session_started'
  | 'session_closed'
  | 'user_message'
  | 'assistant_message'
  | 'agent_fallback'
  | 'clarification_requested'
  | 'confirmation_requested'
  | 'confirmation_resolved'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'unsupported_request';

export interface IntexAgentSessionEvent {
  id: string;
  sessionId: string;
  userId: string;
  type: IntexAgentSessionEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Application config from environment
 */
export interface AppConfig {
  auth0Domain: string;
  auth0ClientId: string;
  authAudience: string;
  authServiceUrl: string;
  whatsappServiceUrl: string;
  notionServiceUrl: string;
  mobileNotificationsServiceUrl: string;
  fishingAssistantServiceUrl: string;
  ResearchAgentUrl: string;
  notesAgentUrl: string;
  bookmarksAgentUrl: string;
  calendarAgentUrl: string;
  linearAgentUrl: string;
  codeAgentUrl: string;
  hellscriptAgentUrl: string;
  appSettingsServiceUrl: string;
  llmUsageServiceUrl: string;
  imageServiceUrl: string;
  webAgentUrl: string;
  intexAgentUrl: string;
  firebaseProjectId: string;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  sentryDsn: string;
}

/**
 * Mobile notification from mobile-notifications-service
 */
export interface MobileNotification {
  id: string;
  source: string;
  device: string;
  app: string;
  title: string;
  text: string;
  timestamp: number;
  postTime: string;
  receivedAt: string;
}

/**
 * Mobile notifications list response
 */
export interface MobileNotificationsResponse {
  notifications: MobileNotification[];
  nextCursor?: string;
}

/**
 * Mobile notifications connect response
 */
export interface MobileNotificationsConnectResponse {
  connectionId: string;
  signature: string;
}

/**
 * Notification filter configuration (legacy - from user-service).
 * Requires a unique name and at least one filter criterion.
 */
export interface NotificationFilter {
  name: string;
  app?: string;
  source?: string;
  title?: string;
}

/**
 * Saved notification filter from mobile-notifications-service.
 * app/device are arrays for multi-select, source is single-select.
 */
export interface SavedNotificationFilter {
  id: string;
  name: string;
  app?: string[];
  device?: string[];
  source?: string;
  title?: string;
  createdAt: string;
}

/**
 * Notification filter options from mobile-notifications-service.
 */
export interface NotificationFilterOptions {
  app: string[];
  device: string[];
  source: string[];
}

/**
 * Notification filters data from mobile-notifications-service.
 */
export interface NotificationFiltersData {
  options: NotificationFilterOptions;
  savedFilters: SavedNotificationFilter[];
}

/**
 * User settings from user-service
 */
export interface UserSettings {
  userId: string;
  timezone?: string;
  notifications: {
    filters: NotificationFilter[];
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Note from notes-agent
 */
export interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request to create a note
 */
export interface CreateNoteRequest {
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
}

/**
 * Request to update a note
 */
export interface UpdateNoteRequest {
  title?: string;
  content?: string;
  tags?: string[];
}

/**
 * LLM provider type
 */
export type { LlmProvider };

/**
 * Image size for pricing
 */
export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

/**
 * Model pricing information
 */
export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Record<ImageSize, number>;
  useProviderCost?: boolean;
}

/**
 * Provider pricing information
 */
export interface ProviderPricing {
  provider: LlmProvider;
  models: Record<string, ModelPricing>;
  updatedAt: string;
}

/**
 * All providers pricing response.
 *
 * Matches the shape returned by `llm-usage-service`'s `GET /llm-usage/pricing`
 * (5 providers: google, openai, anthropic, perplexity, openrouter). The 4
 * calculated-cost providers are required; openrouter is included by the
 * backend but its cost comes from the provider's own API response, so the
 * pricing UI only renders the 4 calculated-cost cards.
 */
export interface AllProvidersPricing {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
  openrouter?: ProviderPricing;
}

/**
 * Open Graph preview data for bookmarks
 */
export interface OpenGraphPreview {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
  favicon?: string;
}

/**
 * OG fetch status for bookmarks
 */
export type OgFetchStatus = 'pending' | 'processed' | 'failed';

/**
 * Bookmark from bookmarks-agent
 */
export interface Bookmark {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  description: string | null;
  tags: string[];
  ogPreview: OpenGraphPreview | null;
  ogFetchedAt: string | null;
  ogFetchStatus: OgFetchStatus;
  aiSummary: string | null;
  aiSummarizedAt: string | null;
  source: string;
  sourceId: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request to create a bookmark
 */
export interface CreateBookmarkRequest {
  url: string;
  title?: string | null;
  description?: string | null;
  tags?: string[];
  source: string;
  sourceId: string;
}

/**
 * Request to update a bookmark
 */
export interface UpdateBookmarkRequest {
  title?: string | null;
  description?: string | null;
  tags?: string[];
  archived?: boolean;
}

/**
 * Google Calendar connection status from user-service
 */
export interface GoogleCalendarStatus {
  connected: boolean;
  email?: string;
  scopes?: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export type CalendarDailyNotificationDeliveryStatus = 'ready' | 'setup_required' | 'error';

export interface CalendarDailyNotificationDeliveryReadiness {
  status: CalendarDailyNotificationDeliveryStatus;
  reason?: string;
  message?: string;
}

export interface CalendarDailyNotificationSchedule {
  enabled: boolean;
  localTime: string;
  timeZone?: string;
  nextRunAt?: string;
  lastRunAt?: string;
}

export interface CalendarDailyNotificationSettings {
  schedule: CalendarDailyNotificationSchedule;
  delivery: CalendarDailyNotificationDeliveryReadiness;
}

/**
 * Google Calendar OAuth initiate response
 */
export interface GoogleCalendarInitiateResponse {
  authorizationUrl: string;
}

/**
 * GitHub connection status from user-service
 */
export interface GitHubConnectionStatus {
  connected: boolean;
  username?: string;
  scopes?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Calendar event date/time specification
 */
export interface CalendarEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

/**
 * Calendar event attendee
 */
export interface CalendarEventAttendee {
  email: string;
  optional?: boolean;
  responseStatus?: string;
}

/**
 * Calendar event from calendar-agent
 */
export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
  attendees?: CalendarEventAttendee[];
  htmlLink?: string;
  created?: string;
  updated?: string;
}

/**
 * Failed calendar event from calendar-agent
 * These are events that couldn't be created due to missing/invalid information
 */
export interface FailedCalendarEvent {
  id: string;
  userId: string;
  actionId: string;
  originalText: string;
  summary: string | null;
  start: string | null;
  end: string | null;
  location: string | null;
  description: string | null;
  error: string;
  reasoning: string | null;
  createdAt: string;
}

/**
 * A failed Linear issue extraction, stored for manual review.
 */
export interface FailedLinearIssue {
  id: string;
  userId: string;
  actionId: string;
  originalText: string;
  extractedTitle: string | null;
  extractedPriority: LinearPriority | null;
  error: string;
  reasoning: string | null;
  createdAt: string;
}

/**
 * Linear priority levels (0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low)
 */
export type LinearPriority = 0 | 1 | 2 | 3 | 4;

/**
 * Linear issue state category
 */
export type IssueStateCategory =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'cancelled';

/**
 * Linear issue state
 */
export interface LinearIssueState {
  id: string;
  name: string;
  type: IssueStateCategory;
  color: string;
  position: number;
}

/**
 * Linear issue from linear-agent
 */
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state?: {
    id: string;
    name: string;
    type: IssueStateCategory;
  };
  priority: LinearPriority;
  assignee?: LinearUser | null;
  creator?: LinearUser;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  url: string;
  labels: LinearLabel[];
  /** ID of parent issue (null if top-level, set if subtask) */
  parentId: string | null;
  /** Number of child issues (subtasks) */
  childCount: number;
  /** Child issues (populated when parent issue has children) */
  children: LinearIssue[];
}

/**
 * Linear user
 */
export interface LinearUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/**
 * Linear label
 */
export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

/**
 * Linear team
 */
export interface LinearTeam {
  id: string;
  name: string;
  key: string;
  description?: string;
}

/**
 * Linear connection status from linear-agent
 */
export interface LinearConnectionStatus {
  connected: boolean;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Linear webhook configuration from linear-agent
 */
export interface LinearWebhookConfig {
  webhookUrl: string;
  hasWebhookSecret: boolean;
  teamId: string;
}

/**
 * Grouped issues by dashboard column
 */
export interface GroupedIssues {
  todo: LinearIssue[];
  backlog: LinearIssue[];
  in_progress: LinearIssue[];
  in_review: LinearIssue[];
  to_test: LinearIssue[];
  done: LinearIssue[];
  archive: LinearIssue[];
}

/**
 * Response from list issues endpoint
 */
export interface ListIssuesResponse {
  issues: GroupedIssues;
  teamName: string;
}

/**
 * Calendar preview status
 */
export type CalendarPreviewStatus = 'pending' | 'ready' | 'failed';

/**
 * Calendar preview from calendar-agent
 */
export interface CalendarPreview {
  actionId: string;
  userId: string;
  status: CalendarPreviewStatus;
  summary?: string;
  start?: string;
  end?: string | null;
  location?: string | null;
  description?: string | null;
  duration?: string | null;
  isAllDay?: boolean;
  error?: string;
  reasoning?: string;
  generatedAt: string;
}

/**
 * Worker type determines which model Claude uses.
 */
export type CodeTaskWorkerType = SharedCodeTaskWorkerType;

/**
 * Worker location for routing.
 */
export type CodeTaskWorkerLocation = string;

/**
 * Task status lifecycle.
 */
export type CodeTaskStatus =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'planned'
  | 'implemented'
  | 'reviewed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'archived';

/**
 * Task result on successful completion.
 */
export interface CodeTaskResult {
  prUrl?: string;
  branch?: string;
  commits?: number;
  summary?: string;
  ciFailed?: boolean;
  partialWork?: boolean;
  rebaseResult?:
    | 'success'
    | 'conflict'
    | 'skipped'
    | { attempted: false; reason: 'not_required' }
    | { attempted: true; success: boolean; conflictFiles?: string[] };
  pull_request_outcome_label?: 'commits_pushed' | 'no_changes_needed';
  merge_ready?: '1';
  merge_ready_reason?: 'review_no_remediation' | 'pull_request_no_changes_rebase_clean' | 'remediation_already_completed' | 'review_skipped';
  review_comments_posted?: string;
  review_types?: string;
  requirements_tracker_updated?: string;
  /** '0' = no remediation needed, '1' = remediation required. */
  needs_remediation?: string;
}

/**
 * Task error on failure.
 */
export interface CodeTaskError {
  code: string;
  message: string;
  remediation?: {
    action?: 'retry' | 'wait' | 'fix_code' | 'contact_support' | 'retry_smaller';
    retryAfter?: number;
    manualSteps?: string;
    supportLink?: string;
  };
}

export type CodeTaskDispatchStatusReason =
  | 'no_enabled_workers'
  | 'workers_unreachable'
  | 'worker_health_contract_mismatch'
  | 'workers_at_capacity'
  | 'codex_auth_unavailable'
  | 'claude_auth_unavailable'
  | 'provider_auth_unavailable'
  | 'docker_unavailable'
  | 'disk_unavailable'
  | 'unknown_worker_type'
  | 'worker_unavailable'
  | 'worker_busy'
  | 'at_capacity'
  | 'network_error'
  | 'dispatch_failed'
  | 'invalid_response'
  | 'queue_full'
  | 'queue_timeout'
  | 'retry_expired'
  | 'retry_exhausted'
  | 'missing_pr_branch'
  | 'scheduled_wait'
  | 'active_task_blocked';

export interface CodeTaskDispatchStatus {
  state: 'waiting' | 'blocked' | 'terminal';
  reason: CodeTaskDispatchStatusReason;
  terminal: boolean;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  remediation: string;
  workerNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  nextAction: 'will_retry_automatically' | 'retry_after_fix' | 'wait_until_scheduled' | 'wait_for_active_task';
  lastAttemptAt?: string;
  attemptCount?: number;
  expiresAt?: string;
  terminalCause?: {
    reason: CodeTaskDispatchStatusReason;
    message: string;
    remediation: string;
    workerNames: string[];
    lastSeenAt: string;
  };
  workerHealthDetails?: {
    workerName: string;
    tag: string;
    healthy: boolean;
    reason?: string;
    error?: string;
    code?: string;
    missingFields?: string[];
    contractMismatch?: boolean;
  }[];
}

export interface CodeTaskExecutionMemoryMatch {
  memoryId: string;
  title: string;
  memoryType: 'implementation_pattern' | 'verification_pattern' | 'pitfall_pattern' | 'single_artifact_planning' | 'decomposition_pattern' | 'planning_decision' | 'review_finding';
  score: number;
  appliesWhen: string;
  action: string;
  avoid: string;
  verification: string;
}

export interface CodeTaskExecutionMemoryCandidate {
  memoryId: string;
  title: string;
  memoryType: CodeTaskExecutionMemoryMatch['memoryType'];
  vectorScore: number;
  rerankScore: number;
  componentOverlap: number;
  effectiveness: number;
  passedThreshold: boolean;
}

export interface CodeTaskExecutionMemoryContext {
  status: 'none' | 'matched' | 'error';
  applicationId?: string;
  retrievalVersion?: string;
  querySummary?: string;
  matchedAt?: string;
  matchedMemories?: CodeTaskExecutionMemoryMatch[];
  topCandidates?: CodeTaskExecutionMemoryCandidate[];
  totalSearchResults?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface CodeTaskExecutionMemoryPostRun {
  status: 'pending' | 'processing' | 'completed' | 'skipped' | 'error';
  attempts: number;
  lastAttemptAt?: string;
  generatedMemoryIds: string[];
  evaluationSummary?: string;
  skipReason?: 'infra_only' | 'insufficient_signal' | 'already_completed' | 'no_reusable_lesson';
  errorMessage?: string;
  completedAt?: string;
}

export interface CodeTaskCallbackState {
  webhookUrl: string;
  callbackBaseUrl: string;
  owner: 'dev' | 'prod' | 'custom';
  configuredAt: string;
  lastSuccessAt?: string;
  lastSuccessEndpoint?: 'logs' | 'task_event' | 'task_complete' | 'status' | 'turn_metrics';
  lastFailure?: {
    endpoint: 'logs' | 'task_event' | 'task_complete' | 'status' | 'turn_metrics';
    status?: number;
    message: string;
    occurredAt: string;
  };
}

/**
 * Code task from code-agent
 */
export interface CodeTask {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: CodeTaskWorkerType;
  workerLocation: CodeTaskWorkerLocation;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: CodeTaskStatus;
  dedupKey: string;
  callbackReceived: boolean;
  callbackState?: CodeTaskCallbackState;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  linearIssueId?: string;
  linearIssue?: {
    identifier: string;
    parentIdentifier?: string | null;
    title: string;
    state: { name: string; type: string };
    priority: number;
    assignee: { id: string; name: string } | null;
    labels: { id: string; name: string }[];
    url: string;
    commentCount: number;
    lastCommentAt: string | null;
  };
  prNumber?: number;
  agentType?: 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | 'ask_agent';
  implementationTaskId?: string;
  fanOutChildTaskIds?: string[];
  parentTaskId?: string;
  followUpReason?: 'pr_comment' | 'user_feedback' | 'retry' | 'execution_implement' | 'merge_conflict';
  result?: CodeTaskResult;
  error?: CodeTaskError;
  dispatchStatus?: CodeTaskDispatchStatus;
  executionMemoryContext?: CodeTaskExecutionMemoryContext;
  executionMemoryPostRun?: CodeTaskExecutionMemoryPostRun;
  /**
   * User-customised per-task timeout in hours (1–12). Absent when the user
   * accepted the orchestrator default (5h). INT-1585.
   */
  timeoutHours?: number;
}

export type TaskMode = 'planning' | 'execution';

/**
 * Request to submit a code task
 *
 * Linear integration:
 * - If linearIssueId is provided: link to existing issue (backend validates it exists and belongs to user's team)
 * - If linearIssueId is NOT provided: backend creates new issue with auto-generated LLM title
 */
export interface SubmitCodeTaskRequest {
  prompt: string;
  workerType?: CodeTaskWorkerType;
  linearIssueId?: string;
  taskMode?: TaskMode;
  scheduledDispatch?: {
    localDateTime: string;
    timezone: string;
    notBeforeAt: string; // ISO UTC
  };
  /**
   * Optional per-task timeout override in hours (1–12). When omitted, the
   * orchestrator default (5h) applies. INT-1585.
   */
  timeoutHours?: number;
}

/**
 * Response from submitting a code task
 */
export interface SubmitCodeTaskResponse {
  status: 'submitted' | 'failed';
  codeTaskId: string;
}

/**
 * Response from POST /code/ask-agent/start
 */
export interface AskAgentStartResponse {
  status: 'submitted' | 'failed';
  codeTaskId: string;
}

/**
 * Request to retry a failed code task
 */
export interface RetryCodeTaskRequest {
  taskId: string;
  additionalContext?: string;
  workerType?: CodeTaskWorkerType;
}

/**
 * Response from retrying a failed code task
 */
export interface RetryCodeTaskResponse {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: string;
  retriedFrom: string;
}

/**
 * Response from starting execution-agent implementation of a planning task
 */
export interface StartImplementationResponse {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: string;
  implementationOf: string;
}

/**
 * Response from listing code tasks
 */
export interface ListCodeTasksResponse {
  tasks: CodeTask[];
  nextCursor?: string;
}

/**
 * Worker health status tag
 */
export type WorkerStatusTag = 'healthy' | 'orchestrator-unreachable' | 'tunnel-down' | 'unknown' | 'disabled';

/**
 * Worker status details
 */
export interface WorkerStatusDetails {
  capacity?: number;
  available?: number;
  running?: number;
  responseTimeMs?: number;
  reason?: string;
  code?: string;
  error?: string;
  missingFields?: string[];
  contractMismatch?: boolean;
}

/**
 * Worker health status for a single worker
 */
export interface WorkerStatus {
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
  healthy: boolean;
  status: WorkerStatusTag;
  details: WorkerStatusDetails | null;
  checkedAt: string | null;
  stale: boolean;
}

/**
 * Response from worker status endpoint
 */
export interface WorkersStatusResponse {
  workers: WorkerStatus[];
  stale: boolean;
}

/**
 * GitHub Pull Request event types
 */
export type GitHubPREventType =
  | 'pull_request'
  | 'pull_request_review'
  | 'pull_request_review_comment'
  | 'issue_comment'
  | 'push';

/**
 * GitHub Pull Request event from code-agent
 */
export interface GitHubPREvent {
  pullRequestNumber: number;
  title: string | null;
  repository: string;
  eventType: GitHubPREventType;
  action: string | null;
  senderLogin: string;
  createdAt: string;
  eventUrl: string | null;
  body: string | null;
}

/**
 * Response from GitHub PR events endpoint
 */
export interface GitHubPREventsResponse {
  events: GitHubPREvent[];
}

/**
 * Derived PR status for the summaries list view
 */
export type GitHubPRStatus = 'open' | 'closed' | 'merged';

/**
 * PR summary from the github-pr-summaries endpoint
 */
export interface GitHubPRSummary {
  repository: string;
  pullRequestNumber: number;
  title: string | null;
  status: GitHubPRStatus;
  lastActivityAt: string;
}

/**
 * Response from GitHub PR summaries endpoint
 */
export interface GitHubPRSummariesResponse {
  prs: GitHubPRSummary[];
}

export type GitHubWebhookEventType =
  | 'pull_request'
  | 'pull_request_review'
  | 'pull_request_review_comment'
  | 'issue_comment'
  | 'push'
  | 'ping'
  | 'unknown';

export type GitHubWebhookAction =
  | 'opened'
  | 'closed'
  | 'edited'
  | 'synchronize'
  | 'reopened'
  | 'ready_for_review'
  | 'converted_to_draft'
  | 'assigned'
  | 'unassigned'
  | 'labeled'
  | 'unlabeled'
  | 'locked'
  | 'unlocked'
  | 'review_requested'
  | 'review_request_removed'
  | 'milestoned'
  | 'demilestoned'
  | 'enqueued'
  | 'dequeued'
  | 'auto_merge_enabled'
  | 'auto_merge_disabled'
  | 'submitted'
  | 'dismissed'
  | 'created'
  | 'deleted'
  | 'unknown';

export type GitHubDecisionState = 'pending' | 'completed';
export type GitHubDecisionOutcome = 'dispatch' | 'skip' | 'request_review';
export type GitHubDecisionMaker = 'hard_rules' | 'github_agent' | 'webhook_route';
export type GitHubDispatchAction = 'create_task' | 'send_message' | 'create_review_task';
export type GitHubReviewType = 'code_quality' | 'test_quality' | 'plan_review' | 'security' | 'architecture';

export interface GitHubEventLogRow {
  id: string;
  decisionId: string | null;
  normalizedEventId: string | null;
  deliveryId: string | null;
  githubEventName: string;
  eventType: GitHubWebhookEventType;
  action: GitHubWebhookAction | null;
  repository: string | null;
  repositoryId: number | null;
  pullRequestNumber: number | null;
  pullRequestId: number | null;
  senderLogin: string | null;
  senderType: string | null;
  authPassedAt: string;
  updatedAt: string;
  decisionState: GitHubDecisionState;
  decisionOutcome: GitHubDecisionOutcome | null;
  decidedBy: GitHubDecisionMaker | null;
  reason: string | null;
  dispatchAction: GitHubDispatchAction | null;
  reviewTypes: GitHubReviewType[];
  taskId: string | null;
  workerType: string | null;
  decisionLatencyMs: number | null;
}

export interface GitHubEventLogResponse {
  rows: GitHubEventLogRow[];
  nextCursor?: string;
}

// Merge Queue types
export type {
  MergeQueueBranch,
  MergeQueuePr,
  PrFilterStatus,
  MergedPrEntry,
  SkipReason,
  SkippedPrEntry,
  WatchStatus,
  MergeQueueWatch,
} from './mergeQueue.js';

// Hellscript types
export type {
  HellscriptBufferSummary,
  HellscriptEvent,
  HellscriptDraftVersion,
  HellscriptWorkspaceResponse,
  HellscriptMaterializedState,
  HellscriptImposeRequest,
  HellscriptImposeResponse,
  HellscriptIntentKind,
  HellscriptInterpretedIntent,
  WritingCategory,
  WritingStyleConfig,
  WritingSample,
} from './hellscript.js';
export { WRITING_CATEGORIES } from './hellscript.js';

// LLM Usage types
export type {
  UsageEvent,
  UsageEventSortField,
  UsageEventFilters,
  ListLlmUsageEventsRequest,
  ListLlmUsageEventsResponse,
  GetUsageEventResponse,
  AggregateMetrics,
  UsageQueryRow,
  LlmUsageQueryRequest,
  LlmUsageQueryResponse,
} from './llmUsage.js';

export type {
  FishingContentType,
  FishingKnowledgeIndexingStatus,
  FishingEvidenceSourceType,
  FishingChatRole,
  FishingAnswerConfidence,
  FishingDigestGroup,
  FishingDigestItem,
  FishingDigestListResponse,
  FishingIdentityLedgerEntry,
  FishingModeratorEvent,
  FishingOpenThread,
  FishingDigestState,
  FishingDigestDetail,
  FishingKnowledgeFolder,
  FishingKnowledgePage,
  FishingMessageCitation,
  FishingChat,
  FishingChatMessage,
  ListFishingDigestsOptions,
  CreateFishingKnowledgeFolderInput,
  UpdateFishingKnowledgeFolderInput,
  CreateFishingKnowledgePageInput,
  UpdateFishingKnowledgePageInput,
  SendFishingChatMessageResponse,
} from './fishingAssistant.js';
