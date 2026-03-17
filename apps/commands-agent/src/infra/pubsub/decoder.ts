import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';

export function decodePubSubMessage<T>(data: string): Result<T, { message: string }> {
  try {
    const decoded = Buffer.from(data, 'base64').toString('utf-8');
    return ok(JSON.parse(decoded) as T);
  } catch {
    return err({ message: 'Failed to decode PubSub message' });
  }
}
