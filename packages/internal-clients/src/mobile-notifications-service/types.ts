import type {
  InternalHttpClientLogger,
  InternalHttpClientResult,
} from '../shared/createInternalHttpClient.js';

export interface MobileNotificationsServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export interface MobileNotificationsRequestOptions {
  requestId?: string;
  timeoutMs?: number;
}

export type MobileNotificationsServiceResult<T> = InternalHttpClientResult<T>;

export interface ListDigestSubscriptionsRequest {
  userId: string;
}

export interface DigestSubscriptionItem {
  groupKey: string;
  displayName: string;
}

export interface ListDigestSubscriptionsResponse {
  items: DigestSubscriptionItem[];
}

export interface QueryDigestsRequest {
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms?: string[];
  limit?: number;
}

export interface DigestEvidenceItem {
  groupKey: string;
  date: string;
  title: string;
  summaryMarkdown: string;
  messageCount: number;
}

export interface QueryDigestsResponse {
  items: DigestEvidenceItem[];
  truncated: boolean;
}

export interface GetDigestRequest {
  userId: string;
  groupKey: string;
  date: string;
}

export type GetDigestResponse = DigestEvidenceItem;

export interface GetDigestStateRequest {
  userId: string;
  groupKey: string;
}

export interface IdentityLedgerEntry {
  sender: string;
  firstSeen: string;
  totalMessages: number;
  activeDays: number;
  role?: 'member' | 'moderator' | 'newcomer';
  notes?: string;
}

export interface ModeratorEvent {
  date: string;
  topic: string;
  summary: string;
}

export interface OpenThread {
  topic: string;
  openedOn: string;
  lastSignal: string;
  lastSignalDate: string;
}

export interface GetDigestStateResponse {
  userId: string;
  groupKey: string;
  updatedAt: string;
  identityLedger: IdentityLedgerEntry[];
  moderatorEvents: ModeratorEvent[];
  openThreads: OpenThread[];
  recentSummaryDates: string[];
}

export interface QueryGroupMessagesRequest {
  userId: string;
  groupKey: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string[];
  limit?: number;
}

export interface GroupMessageEvidence {
  messageRef: string;
  groupKey: string;
  date: string;
  postTimeSec: number;
  senderLabel?: string | null;
  text: string;
  quote: string;
}

export interface QueryGroupMessagesResponse {
  messages: GroupMessageEvidence[];
  totalRaw: number;
  totalCleaned: number;
  returned: number;
  truncated: boolean;
}

export interface MobileNotificationsServiceClient {
  listDigestSubscriptions(
    input: ListDigestSubscriptionsRequest,
    options?: MobileNotificationsRequestOptions
  ): Promise<MobileNotificationsServiceResult<ListDigestSubscriptionsResponse>>;

  queryDigests(
    input: QueryDigestsRequest,
    options?: MobileNotificationsRequestOptions
  ): Promise<MobileNotificationsServiceResult<QueryDigestsResponse>>;

  getDigest(
    input: GetDigestRequest,
    options?: MobileNotificationsRequestOptions
  ): Promise<MobileNotificationsServiceResult<GetDigestResponse>>;

  getDigestState(
    input: GetDigestStateRequest,
    options?: MobileNotificationsRequestOptions
  ): Promise<MobileNotificationsServiceResult<GetDigestStateResponse>>;

  queryGroupMessages(
    input: QueryGroupMessagesRequest,
    options?: MobileNotificationsRequestOptions
  ): Promise<MobileNotificationsServiceResult<QueryGroupMessagesResponse>>;
}
