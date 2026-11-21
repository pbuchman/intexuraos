import { createHmac } from 'node:crypto';
import { err, ok } from '@intexuraos/common-core';
import { performHttpFetch } from '@intexuraos/common-http';
import { isCodeTaskWorkerTypePolicy } from '@intexuraos/code-task-domain';
import type { PutWorkerTypePolicy } from '../../domain/usecases/workerSettings/updateWorkerTypePolicy.js';
import { generateNonce } from './hmacSigning.js';

const WORKER_TYPES_PATH = '/admin/worker-types';
const UPDATE_TIMEOUT_MS = 5000;

export const putWorkerTypePolicy: PutWorkerTypePolicy = async (worker, update) => {
  const body = JSON.stringify(update);
  const timestamp = String(Date.now());
  const nonce = generateNonce();
  const signature = createHmac('sha256', worker.dispatchSigningSecret)
    .update(`PUT ${WORKER_TYPES_PATH}\n${timestamp}.${nonce}.${body}`)
    .digest('hex');

  try {
    const response = await performHttpFetch(`${worker.url}${WORKER_TYPES_PATH}`, {
      method: 'PUT',
      redirect: 'error',
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': worker.cfAccessClientId,
        'CF-Access-Client-Secret': worker.cfAccessClientSecret,
        'X-Dispatch-Timestamp': timestamp,
        'X-Dispatch-Nonce': nonce,
        'X-Dispatch-Signature': signature,
      },
      body,
    });
    if (response.status === 409) return err('conflict');
    if (response.status === 404 || response.status === 405) return err('unsupported');
    if (response.status === 401 || response.status === 403) return err('unauthorized');
    if (!response.ok) return err('unconfirmed');

    const data: unknown = await response.json();
    if (!isCodeTaskWorkerTypePolicy(data)) return err('unconfirmed');
    return ok({
      enabledWorkerTypes: data.enabledWorkerTypes,
      workerTypesRevision: data.workerTypesRevision,
    });
  } catch {
    return err('unconfirmed');
  }
};
