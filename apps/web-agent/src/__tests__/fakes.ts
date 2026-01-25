import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  LinkPreviewFetcherPort,
  LinkPreview,
  LinkPreviewError,
} from '../domain/index.js';
import type { LlmGenerateClient, GenerateResult, LLMError } from '@intexuraos/llm-factory';
import type {
  PageContentFetcher,
  UserServiceClient,
  LlmSummarizer,
} from '../infra/index.js';
import type { PageContentError, UserServiceError, PageSummaryError } from '../infra/index.js';
import type { PageSummary, SummarizeOptions } from '../infra/index.js';

export class FakeLinkPreviewFetcher implements LinkPreviewFetcherPort {
  private nextResult: Result<LinkPreview, LinkPreviewError> | null = null;
  private results = new Map<string, Result<LinkPreview, LinkPreviewError>>();

  async fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>> {
    if (this.nextResult !== null) {
      const result = this.nextResult;
      this.nextResult = null;
      return result;
    }

    const storedResult = this.results.get(url);
    if (storedResult !== undefined) {
      return storedResult;
    }

    return ok({
      url,
      title: 'Test Title',
      description: 'Test Description',
      image: 'https://example.com/image.jpg',
      siteName: 'Test Site',
    });
  }

  setNextResult(result: Result<LinkPreview, LinkPreviewError>): void {
    this.nextResult = result;
  }

  setResultForUrl(url: string, result: Result<LinkPreview, LinkPreviewError>): void {
    this.results.set(url, result);
  }

  setFailNext(errorCode: LinkPreviewError['code'], message?: string): void {
    this.nextResult = err({
      code: errorCode,
      message: message ?? `Test error: ${errorCode}`,
    });
  }

  clear(): void {
    this.nextResult = null;
    this.results.clear();
  }
}

export class FakePageSummaryService {
  private nextResult: Result<PageSummary, PageSummaryError> | null = null;
  private results = new Map<string, Result<PageSummary, PageSummaryError>>();
  public calls: { url: string; options?: SummarizeOptions }[] = [];

  async summarizePage(
    url: string,
    options?: SummarizeOptions
  ): Promise<Result<PageSummary, PageSummaryError>> {
    this.calls.push({ url, ...(options !== undefined && { options }) });

    if (this.nextResult !== null) {
      const result = this.nextResult;
      this.nextResult = null;
      return result;
    }

    const storedResult = this.results.get(url);
    if (storedResult !== undefined) {
      return storedResult;
    }

    return ok({
      url,
      summary: 'Test summary of the page content.',
      wordCount: 8,
      estimatedReadingMinutes: 1,
    });
  }

  setNextResult(result: Result<PageSummary, PageSummaryError>): void {
    this.nextResult = result;
  }

  setResultForUrl(url: string, result: Result<PageSummary, PageSummaryError>): void {
    this.results.set(url, result);
  }

  setFailNext(errorCode: PageSummaryError['code'], message?: string): void {
    this.nextResult = err({
      code: errorCode,
      message: message ?? `Test error: ${errorCode}`,
    });
  }

  clear(): void {
    this.nextResult = null;
    this.results.clear();
    this.calls = [];
  }
}

export class FakeLlmGenerateClient implements LlmGenerateClient {
  private response = 'This is a test summary of the page content.';
  private shouldFail = false;
  private generateCalls: string[] = [];

  async generate(prompt: string): Promise<Result<GenerateResult, LLMError>> {
    this.generateCalls.push(prompt);

    if (this.shouldFail) {
      return err({
        code: 'API_ERROR',
        message: 'Test LLM generation failed',
      });
    }

    return ok({
      content: this.response,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
    });
  }

  setResponse(response: string): void {
    this.response = response;
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  getGenerateCalls(): string[] {
    return this.generateCalls;
  }

  clear(): void {
    this.response = 'This is a test summary of the page content.';
    this.shouldFail = false;
    this.generateCalls = [];
  }
}

export class FakeUserServiceClient implements UserServiceClient {
  private llmClient: LlmGenerateClient = new FakeLlmGenerateClient();
  private shouldFail = false;
  private failCode: UserServiceError['code'] = 'NO_API_KEY';
  private failMessage = 'No API key configured';

  async getLlmClient(_userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
    if (this.shouldFail) {
      return err({
        code: this.failCode,
        message: this.failMessage,
      });
    }
    return ok(this.llmClient);
  }

  async getApiKeys(_userId: string): Promise<Result<import('@intexuraos/internal-clients/user-service').DecryptedApiKeys, UserServiceError>> {
    if (this.shouldFail) {
      return err({
        code: this.failCode,
        message: this.failMessage,
      });
    }
    return ok({});
  }

  async reportLlmSuccess(_userId: string, _provider: string): Promise<void> {
    // Best effort - silently ignore in tests
  }

  setLlmClient(client: LlmGenerateClient): void {
    this.llmClient = client;
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  setFailNext(code: UserServiceError['code'], message?: string): void {
    this.shouldFail = true;
    this.failCode = code;
    this.failMessage = message ?? `Test error: ${code}`;
  }

  clear(): void {
    this.shouldFail = false;
    if (this.llmClient instanceof FakeLlmGenerateClient) {
      this.llmClient.clear();
    }
  }
}

export class FakePageContentFetcher implements PageContentFetcher {
  private content = '# Test Page\n\nThis is test content about AI and technology.';
  private shouldFail = false;
  private failCode: PageContentError['code'] = 'NO_CONTENT';
  private fetchCalls: string[] = [];

  async fetchPageContent(url: string): Promise<Result<string, PageContentError>> {
    this.fetchCalls.push(url);

    if (this.shouldFail) {
      return err({
        code: this.failCode,
        message: 'Test fetch failed',
      });
    }

    return ok(this.content);
  }

  setContent(content: string): void {
    this.content = content;
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  setFailNext(code: PageContentError['code']): void {
    this.shouldFail = true;
    this.failCode = code;
  }

  getFetchCalls(): string[] {
    return this.fetchCalls;
  }

  clear(): void {
    this.content = '# Test Page\n\nThis is test content about AI and technology.';
    this.shouldFail = false;
    this.fetchCalls = [];
  }
}

export class FakeLlmSummarizer implements LlmSummarizer {
  private summary = 'This is a clean summary.';
  private shouldFail = false;
  private summarizeCalls: { content: string; options: SummarizeOptions }[] = [];

  async summarize(
    content: string,
    options: SummarizeOptions,
    _llmClient: LlmGenerateClient
  ): Promise<Result<PageSummary, PageSummaryError>> {
    this.summarizeCalls.push({ content, options });

    if (this.shouldFail) {
      return err({
        code: 'API_ERROR',
        message: 'Test summarization failed',
      });
    }

    return ok({
      url: options.url,
      summary: this.summary,
      wordCount: this.summary.split(/\s+/).length,
      estimatedReadingMinutes: 1,
    });
  }

  setSummary(summary: string): void {
    this.summary = summary;
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  getSummarizeCalls(): { content: string; options: SummarizeOptions }[] {
    return this.summarizeCalls;
  }

  clear(): void {
    this.summary = 'This is a clean summary.';
    this.shouldFail = false;
    this.summarizeCalls = [];
  }
}
