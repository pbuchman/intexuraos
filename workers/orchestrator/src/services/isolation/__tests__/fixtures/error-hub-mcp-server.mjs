import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';

const eventId = process.env['FIXTURE_EVENT_ID'];
const host = process.env['FIXTURE_HOST'];
if (eventId === undefined || host === undefined) process.exit(2);

const organization = 'intexuraos';
const issueId = '42';
const shortId = 'INTEXURA-HUB-42';
const projectSlug = 'intexuraos-backend';
const origin = `https://${host}:8443`;

function eventPayload() {
  const timestamp = new Date().toISOString();
  return {
    id: eventId,
    eventID: eventId,
    title: 'Controlled SentryBox validation fault',
    message: 'Controlled SentryBox validation fault',
    platform: 'node',
    type: 'error',
    culprit: 'emitControlledIssue',
    dateCreated: timestamp,
    dateReceived: timestamp,
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              type: 'ControlledSentryBoxValidationFault',
              value: 'Controlled SentryBox validation fault',
              mechanism: { type: 'generic', handled: true },
              stacktrace: {
                frames: [
                  {
                    filename: 'scripts/acceptance/emit-controlled-issue.mjs',
                    function: 'emitControlledIssue',
                    lineNo: 1,
                    colNo: 1,
                    absPath: '/repo/scripts/acceptance/emit-controlled-issue.mjs',
                    inApp: true,
                  },
                ],
              },
            },
          ],
        },
      },
    ],
    contexts: { runtime: { type: 'runtime', name: 'node', version: '22.23.1' } },
    context: { requestId: 'error-hub-mcp-e2e' },
    tags: [
      { key: 'environment', value: 'dev' },
      { key: 'release', value: 'intexuraos-sentrybox-acceptance@1.0.0' },
      { key: 'service', value: 'sentrybox-acceptance' },
    ],
    occurrenceCount: 1,
    issue: shortId,
    project: projectSlug,
    permalink: `${origin}/organizations/${organization}/issues/${issueId}/events/${eventId}/`,
    evidence: { requestId: 'error-hub-mcp-e2e', traceId: null, taskId: null },
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

const server = createServer(
  {
    cert: readFileSync('/fixture/tls/cert.pem'),
    key: readFileSync('/fixture/tls/key.pem'),
  },
  (request, response) => {
    writeFileSync(
      '/tmp/last-peer.json',
      JSON.stringify({
        address: request.socket.remoteAddress,
        family: request.socket.remoteFamily,
      })
    );
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'GET' || request.headers.authorization !== 'Bearer tailnet-only') {
      sendJson(response, 401, { detail: 'Unauthorized' });
      return;
    }

    const path = new URL(request.url ?? '/', origin).pathname;
    if (path === `/api/0/organizations/${organization}/issues/${issueId}/`) {
      const timestamp = new Date().toISOString();
      sendJson(response, 200, {
        id: issueId,
        shortId,
        title: 'Controlled SentryBox validation fault',
        firstSeen: timestamp,
        lastSeen: timestamp,
        count: '1',
        userCount: 0,
        permalink: `${origin}/organizations/${organization}/issues/${issueId}/`,
        project: { id: '1', slug: projectSlug, name: 'IntexuraOS Backend' },
        platform: 'node',
        status: 'unresolved',
        culprit: 'emitControlledIssue',
        type: 'error',
        issueCategory: 'error',
      });
      return;
    }
    if (path === `/api/0/organizations/${organization}/issues/${shortId}/events/latest/`) {
      sendJson(response, 200, eventPayload());
      return;
    }
    if (path === `/api/0/organizations/${organization}/issues/${issueId}/events/`) {
      const event = eventPayload();
      sendJson(response, 200, [
        {
          id: event.id,
          eventID: event.eventID,
          issue: shortId,
          project: projectSlug,
          title: event.title,
          level: 'error',
          'error.type': 'ControlledSentryBoxValidationFault',
          'error.value': 'Controlled SentryBox validation fault',
          message: event.message,
          culprit: event.culprit,
          timestamp: event.dateCreated,
          environment: 'dev',
          release: 'intexuraos-sentrybox-acceptance@1.0.0',
          service: 'sentrybox-acceptance',
          'count()': 1,
          permalink: event.permalink,
        },
      ]);
      return;
    }
    sendJson(response, 404, { detail: 'Unsupported endpoint' });
  }
);

server.listen({ host: '::', ipv6Only: true, port: 8443 });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
