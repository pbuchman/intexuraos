import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  NormalizedSentryIssueEvent,
  SentryIssueEventParseError,
} from '../domain/models/sentryIssueEvent.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function readData(payload: Record<string, unknown>): Record<string, unknown> | null {
  const data = payload['data'];
  return isRecord(data) ? data : null;
}

function readAction(payload: Record<string, unknown>): string {
  return readString(payload, 'action') ?? 'unknown';
}

function extractUrlParts(url: string): {
  organizationSlug: string | undefined;
  issueId: string | undefined;
  issueUrl: string | undefined;
} {
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    const hostOrg = hostParts.length >= 3 && hostParts[1] === 'sentry'
      ? hostParts[0]
      : undefined;
    const organizationMatch = /\/organizations\/([^/]+)\//.exec(parsed.pathname);
    const issueMatch = /\/issues\/([^/]+)/.exec(parsed.pathname);
    const issueId = issueMatch?.[1];
    const issueUrl = issueId === undefined
      ? undefined
      : organizationMatch?.[1] === undefined
        ? `${parsed.origin}/issues/${issueId}/`
        : `${parsed.origin}/organizations/${organizationMatch[1]}/issues/${issueId}/`;

    return {
      organizationSlug: organizationMatch?.[1] ?? hostOrg,
      issueId,
      issueUrl,
    };
  } catch {
    return {
      organizationSlug: undefined,
      issueId: undefined,
      issueUrl: undefined,
    };
  }
}

function readProject(value: unknown): { projectSlug: string | undefined; projectId: string | undefined } {
  if (typeof value === 'string' && value.trim() !== '') {
    return { projectSlug: value, projectId: undefined };
  }
  if (typeof value === 'number') {
    return { projectSlug: undefined, projectId: String(value) };
  }
  if (isRecord(value)) {
    return {
      projectSlug: readString(value, 'slug') ?? readString(value, 'name'),
      projectId: readString(value, 'id'),
    };
  }
  return { projectSlug: undefined, projectId: undefined };
}

function invalidMissingIssue(): Result<NormalizedSentryIssueEvent, SentryIssueEventParseError> {
  return err({
    code: 'INVALID_PAYLOAD',
    message: 'Sentry webhook payload did not include an issue id or issue URL',
  });
}

function parseIssueWebhook(payload: unknown): Result<NormalizedSentryIssueEvent, SentryIssueEventParseError> {
  if (!isRecord(payload)) {
    return invalidMissingIssue();
  }
  const data = readData(payload);
  const issue = data !== null && isRecord(data['issue']) ? data['issue'] : null;
  if (issue === null) {
    return invalidMissingIssue();
  }

  const issueUrlRaw =
    readString(issue, 'permalink')
    ?? readString(issue, 'web_url')
    ?? readString(issue, 'url');
  const urlParts = issueUrlRaw !== undefined ? extractUrlParts(issueUrlRaw) : undefined;
  const issueId = readString(issue, 'id') ?? urlParts?.issueId;
  const issueUrl = issueUrlRaw;
  if (issueId === undefined || issueUrl === undefined) {
    return invalidMissingIssue();
  }

  const project = readProject(issue['project']);
  const organizationSlug = urlParts?.organizationSlug;
  if (organizationSlug === undefined || project.projectSlug === undefined) {
    return err({
      code: 'INVALID_PAYLOAD',
      message: 'Sentry webhook payload did not include organization or project identity',
    });
  }

  return ok({
    resource: 'issue',
    action: readAction(payload),
    organizationSlug,
    projectSlug: project.projectSlug,
    projectId: project.projectId,
    issueId,
    issueShortId: readString(issue, 'shortId') ?? readString(issue, 'short_id'),
    issueTitle: readString(issue, 'title') ?? issueId,
    issueUrl,
    status: readString(issue, 'status'),
    eventId: undefined,
  });
}

function parseEventAlertWebhook(payload: unknown): Result<NormalizedSentryIssueEvent, SentryIssueEventParseError> {
  if (!isRecord(payload)) {
    return invalidMissingIssue();
  }
  const data = readData(payload);
  const event = data !== null && isRecord(data['event']) ? data['event'] : null;
  if (event === null) {
    return invalidMissingIssue();
  }

  const issueValue = event['issue'];
  const issueObject = isRecord(issueValue) ? issueValue : null;
  const eventWebUrlRaw = readString(event, 'web_url');
  const eventIssueUrlRaw = readString(event, 'issue_url');
  const issueLinkRaw =
    typeof issueValue === 'string'
      ? issueValue
      : issueObject !== null
        ? readString(issueObject, 'permalink') ?? readString(issueObject, 'web_url') ?? readString(issueObject, 'url')
        : undefined;
  const issueLinkUrlParts = issueLinkRaw !== undefined ? extractUrlParts(issueLinkRaw) : undefined;
  const eventWebUrlParts = eventWebUrlRaw !== undefined ? extractUrlParts(eventWebUrlRaw) : undefined;
  const eventIssueUrlParts = eventIssueUrlRaw !== undefined ? extractUrlParts(eventIssueUrlRaw) : undefined;
  const urlParts = issueLinkUrlParts ?? eventWebUrlParts ?? eventIssueUrlParts;
  const issueId = issueObject !== null
    ? readString(issueObject, 'id') ?? readString(event, 'issue_id') ?? urlParts?.issueId
    : readString(event, 'issue_id') ?? urlParts?.issueId;
  const issueUrl =
    issueLinkUrlParts?.issueUrl
    ?? eventWebUrlParts?.issueUrl
    ?? eventIssueUrlParts?.issueUrl
    ?? issueLinkRaw
    ?? eventIssueUrlRaw;
  if (issueId === undefined || issueUrl === undefined) {
    return invalidMissingIssue();
  }

  const project = readProject(event['project'] ?? issueObject?.['project']);
  const projectSlug =
    project.projectSlug
    ?? readString(event, 'project_slug')
    ?? readString(event, 'project_name')
    ?? project.projectId;
  const organizationSlug = urlParts?.organizationSlug;
  if (organizationSlug === undefined || projectSlug === undefined) {
    return err({
      code: 'INVALID_PAYLOAD',
      message: 'Sentry webhook payload did not include organization or project identity',
    });
  }

  return ok({
    resource: 'event_alert',
    action: readAction(payload),
    organizationSlug,
    projectSlug,
    projectId: project.projectId,
    issueId,
    issueShortId: issueObject !== null
      ? readString(issueObject, 'shortId') ?? readString(issueObject, 'short_id')
      : undefined,
    issueTitle: readString(event, 'title') ?? (issueObject !== null ? readString(issueObject, 'title') : undefined) ?? issueId,
    issueUrl,
    status: issueObject !== null ? readString(issueObject, 'status') : undefined,
    eventId: readString(event, 'event_id') ?? readString(event, 'eventId'),
  });
}

export function parseSentryIssueEvent(
  resource: string | undefined,
  payload: unknown
): Result<NormalizedSentryIssueEvent, SentryIssueEventParseError> {
  if (resource === 'issue') {
    return parseIssueWebhook(payload);
  }
  if (resource === 'event_alert') {
    return parseEventAlertWebhook(payload);
  }
  return err({
    code: 'UNSUPPORTED_RESOURCE',
    message: `Unsupported Sentry webhook resource '${resource ?? 'unknown'}'`,
  });
}
