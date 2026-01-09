export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
}

export type LinkPreviewErrorCode = 'FETCH_FAILED' | 'TIMEOUT' | 'TOO_LARGE' | 'INVALID_URL';

export interface LinkPreviewError {
  code: LinkPreviewErrorCode;
  message: string;
}

export type LinkPreviewResultStatus = 'success' | 'failed';

export interface LinkPreviewResultSuccess {
  url: string;
  status: 'success';
  preview: LinkPreview;
}

export interface LinkPreviewResultFailed {
  url: string;
  status: 'failed';
  error: LinkPreviewError;
}

export type LinkPreviewResult = LinkPreviewResultSuccess | LinkPreviewResultFailed;

export interface FetchLinkPreviewsRequest {
  urls: string[];
  timeoutMs?: number;
}

export interface FetchLinkPreviewsResponse {
  results: LinkPreviewResult[];
  metadata: {
    requestedCount: number;
    successCount: number;
    failedCount: number;
    durationMs: number;
  };
}
