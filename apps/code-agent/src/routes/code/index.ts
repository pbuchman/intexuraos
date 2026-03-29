/**
 * Code routes index.
 *
 * Exports all code-related routes for registration with the Fastify server.
 */

import githubPREventsRoute from './github-pre-events.js';
import githubPRSummariesRoute from './github-pr-summaries.js';
import githubEventLogRoute from './github-event-log.js';
import issueGroupRoutes from './issueGroupRoutes.js';

export { githubPREventsRoute, githubPRSummariesRoute, githubEventLogRoute, issueGroupRoutes };
