/**
 * Thin facade over the gitHubDispatch/* modules.
 *
 * The original 681-line file combined webhook dispatch, CI failure dispatch,
 * and PR task helpers. These concerns now live under
 * `./gitHubDispatch/` with this file kept as a stable, backward-compatible
 * surface for existing consumers (services.ts, use cases, tests).
 */

import { executeWebhookDispatch } from './gitHubDispatch/webhookDispatch.js';
import { executeCIFailureDispatch } from './gitHubDispatch/ciFailureDispatch.js';
import type {
  CIFailureDispatchContext,
  CIFailureDispatchResult,
  CIFailureDispatchService,
  DispatchContext,
  WebhookDispatchResult,
  WebhookDispatchService,
  WebhookDispatchServiceDeps,
} from './gitHubDispatch/types.js';

export type {
  DispatchContext,
  WebhookDispatchResult,
  WebhookDispatchService,
  CIFailureDispatchContext,
  CIFailureDispatchResult,
  CIFailureDispatchService,
  WebhookDispatchServiceDeps,
};

// Re-export shared helpers so existing import paths keep working.
export {
  resolveWorkerCredentials,
  resolveLoginForTaskCreation,
  isStaleTaskError,
} from './gitHubDispatch/prTaskHelpers.js';

export function createWebhookDispatchService(deps: WebhookDispatchServiceDeps): WebhookDispatchService & CIFailureDispatchService {
  return {
    dispatch: (context: DispatchContext): Promise<WebhookDispatchResult> => executeWebhookDispatch(deps, context),
    dispatchCIFailure: (context: CIFailureDispatchContext): Promise<CIFailureDispatchResult> =>
      executeCIFailureDispatch(deps, context),
  };
}
