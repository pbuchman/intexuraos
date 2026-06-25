/**
 * E2E mock factories for code-agent external-dependency clients and publishers.
 *
 * Used only when E2E_MODE=true to isolate code-agent from Linear
 * and Pub/Sub topics that aren't available in e2e test environments.
 */

import { ok, type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { PRTriagePublisher } from '@intexuraos/pr-triage-pubsub-client';
import type { WhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import type { IssueContext, LinearAgentClient, LinearAgentError } from '../../domain/ports/linearAgentClient.js';

export interface E2EMocks {
  whatsappPublisher: WhatsAppSendPublisher;
  prTriagePublisher: PRTriagePublisher;
  linearAgentClient: LinearAgentClient;
}

/**
 * Create a no-op WhatsApp publisher for E2E testing.
 */
function createE2eWhatsAppPublisher(): WhatsAppSendPublisher {
  return {
    publishSendMessage(): ReturnType<WhatsAppSendPublisher['publishSendMessage']> {
      return Promise.resolve(ok(undefined));
    },
  };
}

/**
 * Create a no-op PR triage publisher for E2E testing.
 */
function createE2ePRTriagePublisher(): PRTriagePublisher {
  return {
    publishPRTriage(): ReturnType<PRTriagePublisher['publishPRTriage']> {
      return Promise.resolve(ok(undefined));
    },
  };
}

/**
 * Create a no-op Linear agent client for E2E testing.
 */
function createE2eLinearAgentClient(logger: Logger): LinearAgentClient {
  return {
    createIssue(request): ReturnType<LinearAgentClient['createIssue']> {
      const issueNum = Date.now() % 10000;
      logger.info({ title: request.title }, '[E2E] Mock Linear issue creation');
      return Promise.resolve(ok({
        issueId: `INT-${String(issueNum)}`,
        issueIdentifier: `INT-${String(issueNum)}`,
        issueTitle: request.title,
        issueUrl: `https://linear.app/intexura/issue/INT-${String(issueNum)}`,
      }));
    },
    updateIssueState(request): ReturnType<LinearAgentClient['updateIssueState']> {
      logger.info({ issueId: request.issueId, state: request.state }, '[E2E] Mock Linear state update');
      return Promise.resolve(ok(undefined));
    },
    validateIssue(request): ReturnType<LinearAgentClient['validateIssue']> {
      logger.info({ identifier: request.identifier }, '[E2E] Mock Linear issue validation');
      return Promise.resolve(ok({
        id: `issue-${request.identifier}`,
        identifier: request.identifier,
        title: `Mock ${request.identifier}`,
        url: `https://linear.app/intexura/issue/${request.identifier}`,
        labels: [],
        childCount: 0,
        parentId: null,
      }));
    },
    generateTitle(request): ReturnType<LinearAgentClient['generateTitle']> {
      logger.info({ descriptionLength: request.description.length }, '[E2E] Mock title generation');
      return Promise.resolve(ok({
        title: request.description.slice(0, 80),
        issueType: 'feature',
      }));
    },
    addComment(request): ReturnType<LinearAgentClient['addComment']> {
      logger.info({ issueId: request.issueId }, '[E2E] Mock Linear comment addition');
      return Promise.resolve(ok({
        commentId: `comment-${String(Date.now())}`,
      }));
    },
    fetchIssueTree(request): ReturnType<LinearAgentClient['fetchIssueTree']> {
      logger.info({ issueId: request.issueId }, '[E2E] Mock Linear issue tree fetch');
      return Promise.resolve(ok({
        root: {
          id: request.issueId,
          identifier: `INT-${request.issueId}`,
          url: `https://linear.app/pbuchman/issue/${request.issueId}`,
          parentId: null,
          labels: [],
          assigneeId: null,
          state: 'Backlog',
        },
        descendants: [],
      }));
    },
    fetchDirectChildrenLive(request): ReturnType<LinearAgentClient['fetchDirectChildrenLive']> {
      logger.info({ issueId: request.issueId }, '[E2E] Mock live direct children fetch');
      return Promise.resolve(ok([]));
    },
    updateIssueMetadata(request): ReturnType<LinearAgentClient['updateIssueMetadata']> {
      logger.info(
        { issueId: request.issueId, addLabels: request.addLabels, removeLabels: request.removeLabels, assigneeId: request.assigneeId },
        '[E2E] Mock Linear metadata update'
      );
      return Promise.resolve(ok({ droppedLabels: [] }));
    },
    fetchIssueForDisplay(request): ReturnType<LinearAgentClient['fetchIssueForDisplay']> {
      logger.info({ identifier: request.identifier }, '[E2E] Mock Linear issue fetch for display');
      return Promise.resolve(ok({
        identifier: request.identifier,
        parentIdentifier: null,
        title: `Mock ${request.identifier}`,
        state: { name: 'In Progress', type: 'started' },
        priority: 2,
        assignee: null,
        labels: [],
        url: `https://linear.app/intexura/issue/${request.identifier}`,
        commentCount: 0,
        lastCommentAt: null,
      }));
    },
    fetchIssuesForDisplay(request): ReturnType<LinearAgentClient['fetchIssuesForDisplay']> {
      logger.info({ issueCount: request.identifiers.length }, '[E2E] Mock Linear issues fetch for display');
      return Promise.resolve(ok(
        request.identifiers.map((identifier) => ({
          identifier,
          parentIdentifier: null,
          title: `Mock ${identifier}`,
          state: { name: 'In Progress', type: 'started' as const },
          priority: 2,
          assignee: null,
          labels: [],
          url: `https://linear.app/intexura/issue/${identifier}`,
          commentCount: 0,
          lastCommentAt: null,
        }))
      ));
    },
    getIssueDescription(): ReturnType<LinearAgentClient['getIssueDescription']> {
      return Promise.resolve(ok(undefined));
    },
    getIssueContext(_request: { identifier: string }): Promise<Result<IssueContext, LinearAgentError>> {
      logger.info({}, '[E2E] getIssueContext → returning empty context');
      return Promise.resolve(ok({ description: null, comments: [] }));
    },
  };
}

/**
 * Build the complete set of E2E mock clients and publishers.
 */
export function createE2EMocks(logger: Logger): E2EMocks {
  return {
    whatsappPublisher: createE2eWhatsAppPublisher(),
    prTriagePublisher: createE2ePRTriagePublisher(),
    linearAgentClient: createE2eLinearAgentClient(logger),
  };
}
