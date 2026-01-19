export interface PageSummary {
  url: string;
  summary: string;
  wordCount: number;
  estimatedReadingMinutes: number;
}

export type PageSummaryErrorCode =
  | 'FETCH_FAILED'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'INVALID_URL'
  | 'NO_CONTENT'
  | 'API_ERROR';

export interface PageSummaryError {
  code: PageSummaryErrorCode;
  message: string;
}

export interface SummarizePageRequest {
  url: string;
  maxSentences?: number;
  maxReadingMinutes?: number;
}

export interface SummarizePageResponse {
  result: PageSummaryResult;
  metadata: {
    durationMs: number;
  };
}

export type PageSummaryResultStatus = 'success' | 'failed';

export interface PageSummaryResultSuccess {
  url: string;
  status: 'success';
  summary: PageSummary;
}

export interface PageSummaryResultFailed {
  url: string;
  status: 'failed';
  error: PageSummaryError;
}

export type PageSummaryResult = PageSummaryResultSuccess | PageSummaryResultFailed;
