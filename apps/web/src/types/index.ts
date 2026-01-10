import type { LlmProvider } from '@intexuraos/llm-contract';
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
  promptVaultPageId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Notion connect response
 */
export interface NotionConnectResponse {
  connected: boolean;
  promptVaultPageId: string;
  createdAt: string;
  updatedAt: string;
  pageTitle?: string;
  pageUrl?: string;
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
export type WhatsAppMediaType = 'text' | 'image' | 'audio';

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

/**
 * Application config from environment
 */
export interface AppConfig {
  auth0Domain: string;
  auth0ClientId: string;
  authAudience: string;
  authServiceUrl: string;
  promptVaultServiceUrl: string;
  whatsappServiceUrl: string;
  notionServiceUrl: string;
  mobileNotificationsServiceUrl: string;
  ResearchAgentUrl: string;
  commandsRouterServiceUrl: string;
  actionsAgentUrl: string;
  dataInsightsServiceUrl: string;
  notesAgentUrl: string;
  todosAgentUrl: string;
  bookmarksAgentUrl: string;
  calendarAgentUrl: string;
  appSettingsServiceUrl: string;
  firebaseProjectId: string;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
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
  notifications: {
    filters: NotificationFilter[];
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Command classification type from commands-router
 */
export type CommandType =
  | 'todo'
  | 'research'
  | 'note'
  | 'link'
  | 'calendar'
  | 'reminder'
  | 'unclassified';

/**
 * Command status
 */
export type CommandStatus =
  | 'received'
  | 'classified'
  | 'pending_classification'
  | 'failed'
  | 'archived';

/**
 * Command source type
 */
export type CommandSourceType = 'whatsapp_text' | 'whatsapp_voice' | 'pwa-shared';

/**
 * Command classification details
 */
export interface CommandClassification {
  type: CommandType;
  confidence: number;
  reasoning: string;
  classifiedAt: string;
}

/**
 * Command from commands-router
 */
export interface Command {
  id: string;
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  timestamp: string;
  status: CommandStatus;
  classification?: CommandClassification;
  actionId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Action status
 */
export type ActionStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'archived';

/**
 * Action from commands-router
 */
export interface Action {
  id: string;
  userId: string;
  commandId: string;
  type: CommandType;
  confidence: number;
  title: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Commands list response
 */
export interface CommandsResponse {
  commands: Command[];
  nextCursor?: string;
}

/**
 * Actions list response
 */
export interface ActionsResponse {
  actions: Action[];
  nextCursor?: string;
}

/**
 * Custom data source from data-insights-service
 */
export interface DataSource {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request to create a data source
 */
export interface CreateDataSourceRequest {
  title: string;
  content: string;
}

/**
 * Request to update a data source
 */
export interface UpdateDataSourceRequest {
  title?: string;
  content?: string;
}

/**
 * Response from generate title endpoint
 */
export interface GenerateTitleResponse {
  title: string;
}

/**
 * Notification filter configuration for composite feeds.
 * app is multi-select (array), source is single-select (string).
 */
export interface CompositeFeedNotificationFilter {
  id: string;
  name: string;
  app?: string[];
  source?: string;
  title?: string;
}

/**
 * Composite feed from data-insights-service.
 * Aggregates static data sources and notification filters.
 */
export interface CompositeFeed {
  id: string;
  userId: string;
  name: string;
  purpose: string;
  staticSourceIds: string[];
  notificationFilters: CompositeFeedNotificationFilter[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Request to create a composite feed.
 */
export interface CreateCompositeFeedRequest {
  purpose: string;
  staticSourceIds: string[];
  notificationFilters: Omit<CompositeFeedNotificationFilter, 'id'>[];
}

/**
 * Request to update a composite feed.
 */
export interface UpdateCompositeFeedRequest {
  purpose?: string;
  staticSourceIds?: string[];
  notificationFilters?: Omit<CompositeFeedNotificationFilter, 'id'>[];
}

/**
 * Static source data in composite feed response.
 */
export interface CompositeFeedStaticSource {
  id: string;
  name: string;
  content: string;
}

/**
 * Notification item in composite feed response.
 */
export interface CompositeFeedNotificationItem {
  id: string;
  app: string;
  title: string;
  body: string;
  timestamp: string;
  source?: string;
}

/**
 * Filtered notifications section in composite feed data.
 */
export interface CompositeFeedFilteredNotifications {
  filterId: string;
  filterName: string;
  criteria: {
    app?: string[];
    source?: string[];
    title?: string;
  };
  items: CompositeFeedNotificationItem[];
}

/**
 * Composite feed data response.
 */
export interface CompositeFeedData {
  feedId: string;
  feedName: string;
  purpose: string;
  generatedAt: string;
  staticSources: CompositeFeedStaticSource[];
  notifications: CompositeFeedFilteredNotifications[];
}

/**
 * Pre-computed composite feed snapshot
 */
export interface CompositeFeedSnapshot extends CompositeFeedData {
  expiresAt: string;
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
 * Todo priority levels
 */
export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Todo status values
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Todo item (nested within a todo)
 */
export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
  priority: TodoPriority | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Todo from todos-agent
 */
export interface Todo {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
  priority: TodoPriority;
  dueDate: string | null;
  source: string;
  sourceId: string;
  status: TodoStatus;
  archived: boolean;
  items: TodoItem[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request to create a todo
 */
export interface CreateTodoRequest {
  title: string;
  description?: string | null;
  tags: string[];
  priority?: TodoPriority;
  dueDate?: string | null;
  source: string;
  sourceId: string;
  items?: {
    title: string;
    priority?: TodoPriority | null;
    dueDate?: string | null;
  }[];
}

/**
 * Request to update a todo
 */
export interface UpdateTodoRequest {
  title?: string;
  description?: string | null;
  tags?: string[];
  priority?: TodoPriority;
  dueDate?: string | null;
}

/**
 * Request to create a todo item
 */
export interface CreateTodoItemRequest {
  title: string;
  priority?: TodoPriority | null;
  dueDate?: string | null;
}

/**
 * Request to update a todo item
 */
export interface UpdateTodoItemRequest {
  title?: string;
  status?: TodoStatus;
  priority?: TodoPriority | null;
  dueDate?: string | null;
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
 * All providers pricing response
 */
export interface AllProvidersPricing {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
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

/**
 * Google Calendar OAuth initiate response
 */
export interface GoogleCalendarInitiateResponse {
  authorizationUrl: string;
}

/**
 * Monthly cost breakdown for LLM usage
 */
export interface MonthlyCost {
  month: string;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  percentage: number;
}

/**
 * Cost breakdown by LLM model
 */
export interface ModelCost {
  model: string;
  costUsd: number;
  calls: number;
  percentage: number;
}

/**
 * Cost breakdown by call type
 */
export interface CallTypeCost {
  callType: string;
  costUsd: number;
  calls: number;
  percentage: number;
}

/**
 * Aggregated LLM usage costs for a user
 */
export interface AggregatedCosts {
  totalCostUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  monthlyBreakdown: MonthlyCost[];
  byModel: ModelCost[];
  byCallType: CallTypeCost[];
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
