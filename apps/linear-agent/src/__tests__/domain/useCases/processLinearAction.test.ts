/**
 * Tests for processLinearAction use case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { err } from '@intexuraos/common-core';
import type { LinearConnection } from '../../../domain/models.js';
import {
  processLinearAction,
  type ProcessLinearActionRequest,
} from '../../../domain/useCases/processLinearAction.js';
import {
  FakeLinearConnectionRepository,
  FakeLinearApiClient,
  FakeLinearActionExtractionService,
  FakeFailedIssueRepository,
  FakeProcessedActionRepository,
} from '../../fakes.js';

describe('processLinearAction', () => {
  let fakeConnectionRepo: FakeLinearConnectionRepository;
  let fakeLinearClient: FakeLinearApiClient;
  let fakeExtractionService: FakeLinearActionExtractionService;
  let fakeFailedIssueRepo: FakeFailedIssueRepository;
  let fakeProcessedActionRepo: FakeProcessedActionRepository;

  beforeEach(() => {
    fakeConnectionRepo = new FakeLinearConnectionRepository();
    fakeLinearClient = new FakeLinearApiClient();
    fakeExtractionService = new FakeLinearActionExtractionService();
    fakeFailedIssueRepo = new FakeFailedIssueRepository();
    fakeProcessedActionRepo = new FakeProcessedActionRepository();
  });

  afterEach(() => {
    fakeConnectionRepo.reset();
    fakeLinearClient.reset();
    fakeExtractionService.reset();
    fakeFailedIssueRepo.reset();
    fakeProcessedActionRepo.reset();
  });

  const defaultRequest: ProcessLinearActionRequest = {
    actionId: 'action-123',
    userId: 'user-456',
    text: 'Create a Linear issue for fixing the login bug',
  };

  function setupConnectedUser(): void {
    const connection: LinearConnection = {
      userId: 'user-456',
      apiKey: 'linear-api-key',
      teamId: 'team-789',
      teamName: 'Engineering',
      connected: true,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    };
    fakeConnectionRepo.seedConnection(connection);
  }

  describe('success path', () => {
    beforeEach(() => {
      setupConnectedUser();
      fakeExtractionService.setResponse({
        title: 'Fix login authentication bug',
        priority: 2,
        functionalRequirements: 'User should be able to login with Google OAuth',
        technicalDetails: 'Check token validation in auth.ts',
        valid: true,
        error: null,
        reasoning: 'Issue is clear and actionable',
      });
    });

    it('creates issue successfully with all extracted data', async () => {
      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.resourceUrl).toBeDefined();
        expect(result.value.message).toMatch(/Issue ENG-\d+ created successfully/);
      }

      // Verify no failed issues were created
      expect(fakeFailedIssueRepo.count).toBe(0);

      // Verify the action was recorded as processed
      expect(fakeProcessedActionRepo.count).toBe(1);
    });

    it('creates issue with null functional and technical details', async () => {
      fakeExtractionService.setResponse({
        title: 'Simple issue',
        priority: 0,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'Basic issue',
      });

      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok && result.value.status).toBe('completed');
    });

    it('builds structured description with both sections', async () => {
      await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      // Verify the Linear API client received the structured description
      const issuesResult = await fakeLinearClient.listIssues('key', 'team-789');
      if (issuesResult.ok && issuesResult.value[0]) {
        expect(issuesResult.value[0].description).toContain('## Functional Requirements');
        expect(issuesResult.value[0].description).toContain('## Technical Details');
      }
    });
  });

  describe('user not connected', () => {
    it('returns NOT_CONNECTED error when user has no connection', async () => {
      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toContain('not connected');
      }

      // No failed issue created for connection error
      expect(fakeFailedIssueRepo.count).toBe(0);
    });
  });

  describe('extraction failure', () => {
    beforeEach(() => {
      setupConnectedUser();
      fakeExtractionService.setFailure(true, {
        code: 'EXTRACTION_FAILED',
        message: 'LLM service unavailable',
      });
    });

    it('returns failed status and saves to failed issues', async () => {
      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('LLM service unavailable');
      }

      // Verify failed issue was saved
      expect(fakeFailedIssueRepo.count).toBe(1);
      const failedIssues = await fakeFailedIssueRepo.listByUser('user-456');
      if (failedIssues.ok && failedIssues.value[0]) {
        expect(failedIssues.value[0].error).toBe('LLM service unavailable');
        expect(failedIssues.value[0].extractedTitle).toBeNull();
      }
    });
  });

  describe('invalid extraction (valid=false)', () => {
    beforeEach(() => {
      setupConnectedUser();
      fakeExtractionService.setResponse({
        title: 'Unclear request',
        priority: 0,
        functionalRequirements: null,
        technicalDetails: null,
        valid: false,
        error: 'The input is too vague. Please provide more details.',
        reasoning: 'User said "fix it" without context',
      });
    });

    it('returns failed status with extraction error', async () => {
      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('The input is too vague. Please provide more details.');
      }
    });

    it('saves failed issue with extracted data', async () => {
      await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(fakeFailedIssueRepo.count).toBe(1);
      const failedIssues = await fakeFailedIssueRepo.listByUser('user-456');
      if (failedIssues.ok && failedIssues.value[0]) {
        const failed = failedIssues.value[0];
        expect(failed.extractedTitle).toBe('Unclear request');
        expect(failed.extractedPriority).toBe(0);
        expect(failed.error).toBe('The input is too vague. Please provide more details.');
        expect(failed.reasoning).toBe('User said "fix it" without context');
      }
    });

    it('handles null error in invalid extraction', async () => {
      fakeExtractionService.setResponse({
        title: 'No error message',
        priority: 0,
        functionalRequirements: null,
        technicalDetails: null,
        valid: false,
        error: null,
        reasoning: 'No reasoning',
      });

      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok && result.value.message).toBe('Could not extract valid issue from message');
    });
  });

  describe('Linear API failure', () => {
    beforeEach(() => {
      setupConnectedUser();
      fakeExtractionService.setResponse({
        title: 'API Test Issue',
        priority: 1,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'Valid issue',
      });
      fakeLinearClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'Linear API rate limit exceeded',
      });
    });

    it('returns failed status and saves to failed issues', async () => {
      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Linear API rate limit exceeded');
      }

      // Verify failed issue was saved with extracted data
      expect(fakeFailedIssueRepo.count).toBe(1);
      const failedIssues = await fakeFailedIssueRepo.listByUser('user-456');
      if (failedIssues.ok && failedIssues.value[0]) {
        const failed = failedIssues.value[0];
        expect(failed.extractedTitle).toBe('API Test Issue');
        expect(failed.extractedPriority).toBe(1);
        expect(failed.error).toBe('Linear API rate limit exceeded');
      }
    });
  });

  describe('connection repository failure', () => {
    it('returns error when getFullConnection fails', async () => {
      // Create a custom fake that returns error
      class FailingConnectionRepo extends FakeLinearConnectionRepository {
        override async getFullConnection(): ReturnType<
          FakeLinearConnectionRepository['getFullConnection']
        > {
          return Promise.resolve(
            err({ code: 'INTERNAL_ERROR', message: 'Database connection failed' })
          );
        }
      }

      const failingRepo = new FailingConnectionRepo();

      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: failingRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database connection failed');
      }
    });
  });

  describe('description builder', () => {
    beforeEach(() => {
      setupConnectedUser();
    });

    it('includes functional requirements when present', async () => {
      fakeExtractionService.setResponse({
        title: 'Feature request',
        priority: 3,
        functionalRequirements: 'Users need to reset password via email',
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'Valid',
      });

      await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      const issuesResult = await fakeLinearClient.listIssues('key', 'team-789');
      if (issuesResult.ok && issuesResult.value[0]?.description) {
        expect(issuesResult.value[0].description).toContain('## Functional Requirements');
        expect(issuesResult.value[0].description).toContain(
          'Users need to reset password via email'
        );
      }
    });

    it('includes technical details when present', async () => {
      fakeExtractionService.setResponse({
        title: 'Bug fix',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: 'Update auth.ts to validate JWT expiration',
        valid: true,
        error: null,
        reasoning: 'Valid',
      });

      await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      const issuesResult = await fakeLinearClient.listIssues('key', 'team-789');
      if (issuesResult.ok && issuesResult.value[0]?.description) {
        expect(issuesResult.value[0].description).toContain('## Technical Details');
        expect(issuesResult.value[0].description).toContain(
          'Update auth.ts to validate JWT expiration'
        );
      }
    });

    it('joins all sections with double newline', async () => {
      fakeExtractionService.setResponse({
        title: 'Complex issue',
        priority: 2,
        functionalRequirements: 'Must support OAuth2',
        technicalDetails: 'Use passport.js',
        valid: true,
        error: null,
        reasoning: 'Valid',
      });

      await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      const issuesResult = await fakeLinearClient.listIssues('key', 'team-789');
      if (issuesResult.ok && issuesResult.value[0]?.description) {
        const desc = issuesResult.value[0].description;
        expect(desc).toContain('## Functional Requirements\n\nMust support OAuth2\n\n## Technical Details');
        expect(desc).toMatch(/## Original User Instruction\n\n>.*\n\n_.*_\n\n## Functional Requirements/s);
      }
    });

    it('includes original user instruction even when both extracted sections are null', async () => {
      fakeExtractionService.setResponse({
        title: 'Simple',
        priority: 0,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'Valid',
      });

      await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      const issuesResult = await fakeLinearClient.listIssues('key', 'team-789');
      if (issuesResult.ok && issuesResult.value[0]?.description) {
        const desc = issuesResult.value[0].description;
        expect(desc).toContain('## Original User Instruction');
        expect(desc).toContain('> Create a Linear issue for fixing the login bug');
      }
    });

    it('includes original user instruction at the TOP of description', async () => {
      fakeExtractionService.setResponse({
        title: 'Full issue',
        priority: 2,
        functionalRequirements: 'Must support SSO',
        technicalDetails: 'Use SAML 2.0',
        valid: true,
        error: null,
        reasoning: 'Valid',
      });

      await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      const issuesResult = await fakeLinearClient.listIssues('key', 'team-789');
      if (issuesResult.ok && issuesResult.value[0]?.description) {
        const desc = issuesResult.value[0].description;
        const originalInstructionIndex = desc.indexOf('## Original User Instruction');
        const functionalIndex = desc.indexOf('## Functional Requirements');
        const technicalIndex = desc.indexOf('## Technical Details');
        expect(originalInstructionIndex).toBe(0);
        expect(originalInstructionIndex).toBeLessThan(functionalIndex);
        expect(originalInstructionIndex).toBeLessThan(technicalIndex);
      }
    });

    it('uses blockquote format for original instruction with disclaimer', async () => {
      const customRequest: ProcessLinearActionRequest = {
        actionId: 'action-abc',
        userId: 'user-456',
        text: 'Fix teh login bugg plz',
      };

      fakeExtractionService.setResponse({
        title: 'Fix login bug',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'Valid',
      });

      await processLinearAction(customRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      const issuesResult = await fakeLinearClient.listIssues('key', 'team-789');
      if (issuesResult.ok && issuesResult.value[0]?.description) {
        const desc = issuesResult.value[0].description;
        expect(desc).toContain('> Fix teh login bugg plz');
        expect(desc).toContain(
          '_This is the original user instruction, transcribed verbatim. May include typos but preserves original observations._'
        );
      }
    });

    it('places Key Points after Original User Instruction but before Functional Requirements', async () => {
      fakeExtractionService.setResponse({
        title: 'Feature with summary',
        priority: 2,
        functionalRequirements: 'User can export data',
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'Valid',
      });

      const requestWithSummary: ProcessLinearActionRequest = {
        ...defaultRequest,
        summary: '- Main requirement A\n- Main requirement B',
      };

      await processLinearAction(requestWithSummary, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      const issuesResult = await fakeLinearClient.listIssues('key', 'team-789');
      if (issuesResult.ok && issuesResult.value[0]?.description) {
        const desc = issuesResult.value[0].description;
        expect(desc).toContain('## Key Points');
        expect(desc).toContain('- Main requirement A\n- Main requirement B');
        expect(desc).toContain('## Functional Requirements');
        const originalInstructionIndex = desc.indexOf('## Original User Instruction');
        const keyPointsIndex = desc.indexOf('## Key Points');
        const functionalIndex = desc.indexOf('## Functional Requirements');
        expect(originalInstructionIndex).toBeLessThan(keyPointsIndex);
        expect(keyPointsIndex).toBeLessThan(functionalIndex);
      }
    });
  });

  describe('idempotency', () => {
    beforeEach(() => {
      setupConnectedUser();
      fakeExtractionService.setResponse({
        title: 'Fix login bug',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'Valid issue',
      });
    });

    it('returns existing result when action was already processed', async () => {
      fakeProcessedActionRepo.seedProcessedAction({
        actionId: 'action-123',
        userId: 'user-456',
        issueId: 'existing-issue-id',
        issueIdentifier: 'ENG-42',
        resourceUrl: 'https://linear.app/team/issue/ENG-42',
        createdAt: '2025-01-15T00:00:00Z',
      });

      const result = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Issue ENG-42 created successfully');
        expect(result.value.resourceUrl).toBe('https://linear.app/team/issue/ENG-42');
      }

      // Verify no new issue was created in Linear
      const issues = await fakeLinearClient.listIssues('key', 'team-789');
      expect(issues.ok && issues.value.length).toBe(0);

      // Verify no new processed action was saved
      expect(fakeProcessedActionRepo.count).toBe(1);
    });

    it('prevents duplicate issue creation on concurrent requests', async () => {
      // First request creates the issue
      const result1 = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result1.ok && result1.value.status).toBe('completed');
      const firstMessage = result1.ok ? result1.value.message : null;

      // Second request with same actionId should return existing result
      const result2 = await processLinearAction(defaultRequest, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.status).toBe('completed');
        expect(result2.value.message).toBe(firstMessage);
      }

      // Only one issue should exist
      const issues = await fakeLinearClient.listIssues('key', 'team-789');
      expect(issues.ok && issues.value.length).toBe(1);
    });

    it('allows different actionIds to create separate issues', async () => {
      const request1: ProcessLinearActionRequest = {
        actionId: 'action-1',
        userId: 'user-456',
        text: 'First issue',
      };

      const request2: ProcessLinearActionRequest = {
        actionId: 'action-2',
        userId: 'user-456',
        text: 'Second issue',
      };

      await processLinearAction(request1, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      await processLinearAction(request2, {
        linearApiClient: fakeLinearClient,
        connectionRepository: fakeConnectionRepo,
        failedIssueRepository: fakeFailedIssueRepo,
        extractionService: fakeExtractionService,
        processedActionRepository: fakeProcessedActionRepo,
      });

      // Two different issues should exist
      const issues = await fakeLinearClient.listIssues('key', 'team-789');
      expect(issues.ok && issues.value.length).toBe(2);

      // Two processed actions should be recorded
      expect(fakeProcessedActionRepo.count).toBe(2);
    });
  });
});
