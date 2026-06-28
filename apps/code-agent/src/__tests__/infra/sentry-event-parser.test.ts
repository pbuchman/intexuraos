/**
 * Tests for normalizing Sentry webhook payloads into issue automation events.
 */

import { describe, expect, it } from 'vitest';
import { parseSentryIssueEvent } from '../../infra/sentry-event-parser.js';

describe('parseSentryIssueEvent', () => {
  it('normalizes issue webhooks into a Sentry issue event', () => {
    const result = parseSentryIssueEvent('issue', {
      action: 'created',
      data: {
        issue: {
          id: '4509001',
          shortId: 'INTEXURAOS-DEVELOPMENT-7',
          title: 'TypeError: Cannot read properties of undefined',
          permalink: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
          status: 'unresolved',
          project: {
            id: '100',
            slug: 'intexuraos-development',
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        resource: 'issue',
        action: 'created',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-development',
        projectId: '100',
        issueId: '4509001',
        issueShortId: 'INTEXURAOS-DEVELOPMENT-7',
        issueTitle: 'TypeError: Cannot read properties of undefined',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
        status: 'unresolved',
        eventId: undefined,
      });
    }
  });

  it('normalizes issue webhooks from organization URLs and fallback fields', () => {
    const result = parseSentryIssueEvent('issue', {
      data: {
        issue: {
          short_id: 'ACME-999',
          web_url: 'https://sentry.io/organizations/acme/issues/999/',
          project: {
            name: 'api',
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        resource: 'issue',
        action: 'unknown',
        organizationSlug: 'acme',
        projectSlug: 'api',
        projectId: undefined,
        issueId: '999',
        issueShortId: 'ACME-999',
        issueTitle: '999',
        issueUrl: 'https://sentry.io/organizations/acme/issues/999/',
        status: undefined,
        eventId: undefined,
      });
    }
  });

  it('normalizes issue webhooks with numeric IDs and string projects', () => {
    const result = parseSentryIssueEvent('issue', {
      action: 'regressed',
      data: {
        issue: {
          id: 1000,
          title: 'ValueError',
          url: 'https://acme.sentry.io/issues/1000/',
          project: 'web',
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        action: 'regressed',
        organizationSlug: 'acme',
        projectSlug: 'web',
        projectId: undefined,
        issueId: '1000',
        issueTitle: 'ValueError',
        issueUrl: 'https://acme.sentry.io/issues/1000/',
      });
    }
  });

  it('normalizes issue webhooks with raw URLs that do not expose an issue path id', () => {
    const result = parseSentryIssueEvent('issue', {
      action: 'created',
      data: {
        issue: {
          id: '2000',
          permalink: 'https://acme.sentry.io/not-an-issue-path/',
          project: 'api',
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        organizationSlug: 'acme',
        issueId: '2000',
        issueUrl: 'https://acme.sentry.io/not-an-issue-path/',
      });
    }
  });


  it('normalizes event_alert webhooks using the nested event issue', () => {
    const result = parseSentryIssueEvent('event_alert', {
      action: 'triggered',
      data: {
        event: {
          event_id: '4f7a4f2c0e8e4c2a9c',
          title: 'Error: fetch failed',
          web_url: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509002/events/4f7a4f2c0e8e4c2a9c/',
          issue: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509002/',
          project: 'intexuraos-web-development',
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        resource: 'event_alert',
        action: 'triggered',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-web-development',
        projectId: undefined,
        issueId: '4509002',
        issueShortId: undefined,
        issueTitle: 'Error: fetch failed',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509002/',
        status: undefined,
        eventId: '4f7a4f2c0e8e4c2a9c',
      });
    }
  });

  it('normalizes official event_alert issue fields with numeric project IDs', () => {
    const result = parseSentryIssueEvent('event_alert', {
      action: 'triggered',
      data: {
        event: {
          event_id: '58839a7c3e2c4205a1a847c1ad3839c6',
          project: 4510702691024976,
          title: 'This is an example node-fastify exception',
          web_url: 'https://sentry.io/organizations/intexuraos/issues/1117540176/events/58839a7c3e2c4205a1a847c1ad3839c6/',
          issue_url: 'https://sentry.io/api/0/issues/1117540176/',
          issue_id: '1117540176',
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        resource: 'event_alert',
        action: 'triggered',
        organizationSlug: 'intexuraos',
        projectSlug: '4510702691024976',
        projectId: '4510702691024976',
        issueId: '1117540176',
        issueShortId: undefined,
        issueTitle: 'This is an example node-fastify exception',
        issueUrl: 'https://sentry.io/organizations/intexuraos/issues/1117540176/',
        status: undefined,
        eventId: '58839a7c3e2c4205a1a847c1ad3839c6',
      });
    }
  });

  it('normalizes event_alert webhooks from nested issue objects', () => {
    const result = parseSentryIssueEvent('event_alert', {
      action: 'resolved',
      data: {
        event: {
          eventId: 'event-camel',
          issue: {
            id: '4509003',
            short_id: 'INTEXURAOS-DEVELOPMENT-9',
            title: 'Nested TypeError',
            status: 'resolved',
            url: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509003/',
            project: {
              id: '101',
              slug: 'intexuraos-api-development',
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        resource: 'event_alert',
        action: 'resolved',
        organizationSlug: 'intexuraos-dev-pbuchman',
        projectSlug: 'intexuraos-api-development',
        projectId: '101',
        issueId: '4509003',
        issueShortId: 'INTEXURAOS-DEVELOPMENT-9',
        issueTitle: 'Nested TypeError',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509003/',
        status: 'resolved',
        eventId: 'event-camel',
      });
    }
  });

  it('normalizes event_alert nested issue objects using the URL issue id fallback', () => {
    const result = parseSentryIssueEvent('event_alert', {
      action: 'triggered',
      data: {
        event: {
          title: 'Nested event',
          issue: {
            url: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509005/',
            project: {
              slug: 'intexuraos-api-development',
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        issueId: '4509005',
        issueTitle: 'Nested event',
        issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509005/',
      });
    }
  });


  it('normalizes event_alert webhooks from event web_url fallback', () => {
    const result = parseSentryIssueEvent('event_alert', {
      data: {
        event: {
          web_url: 'https://acme.sentry.io/issues/42/events/event-42/',
          project: {
            slug: 'web',
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        resource: 'event_alert',
        action: 'unknown',
        organizationSlug: 'acme',
        projectSlug: 'web',
        projectId: undefined,
        issueId: '42',
        issueShortId: undefined,
        issueTitle: '42',
        issueUrl: 'https://acme.sentry.io/issues/42/',
        status: undefined,
        eventId: undefined,
      });
    }
  });

  it('returns INVALID_PAYLOAD when no issue identity can be found', () => {
    const result = parseSentryIssueEvent('event_alert', {
      action: 'triggered',
      data: {
        event: {
          title: 'Error without issue link',
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Sentry webhook payload did not include an issue id or issue URL',
      },
    });
  });

  it('returns INVALID_PAYLOAD when issue payload is missing', () => {
    const result = parseSentryIssueEvent('issue', null);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Sentry webhook payload did not include an issue id or issue URL',
      },
    });
  });

  it('returns INVALID_PAYLOAD when issue data is not an object', () => {
    const result = parseSentryIssueEvent('issue', {
      data: null,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Sentry webhook payload did not include an issue id or issue URL',
      },
    });
  });

  it('returns INVALID_PAYLOAD when issue object has no issue id or URL', () => {
    const result = parseSentryIssueEvent('issue', {
      data: {
        issue: {
          project: 'api',
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Sentry webhook payload did not include an issue id or issue URL',
      },
    });
  });

  it('returns INVALID_PAYLOAD when event_alert data is not an object', () => {
    const result = parseSentryIssueEvent('event_alert', {
      data: null,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Sentry webhook payload did not include an issue id or issue URL',
      },
    });
  });

  it('returns INVALID_PAYLOAD when event_alert payload is missing', () => {
    const result = parseSentryIssueEvent('event_alert', null);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Sentry webhook payload did not include an issue id or issue URL',
      },
    });
  });

  it('returns INVALID_PAYLOAD when organization or project identity is missing', () => {
    const result = parseSentryIssueEvent('issue', {
      data: {
        issue: {
          id: '4509004',
          permalink: 'https://example.com/issues/4509004/',
          project: null,
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Sentry webhook payload did not include organization or project identity',
      },
    });
  });

  it('returns INVALID_PAYLOAD when event_alert organization or project identity is missing', () => {
    const result = parseSentryIssueEvent('event_alert', {
      data: {
        event: {
          issue: 'https://acme.sentry.io/issues/4509006/',
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Sentry webhook payload did not include organization or project identity',
      },
    });
  });

  it('returns UNSUPPORTED_RESOURCE for non-issue resources', () => {
    const result = parseSentryIssueEvent('metric_alert', {
      action: 'triggered',
      data: {},
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNSUPPORTED_RESOURCE',
        message: "Unsupported Sentry webhook resource 'metric_alert'",
      },
    });
  });

  it('returns UNSUPPORTED_RESOURCE for missing resource headers', () => {
    const result = parseSentryIssueEvent(undefined, {
      action: 'triggered',
      data: {},
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNSUPPORTED_RESOURCE',
        message: "Unsupported Sentry webhook resource 'unknown'",
      },
    });
  });
});
