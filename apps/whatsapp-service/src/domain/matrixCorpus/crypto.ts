import { createHash, createHmac } from 'node:crypto';

import type { MatrixCorpusReplayProjectionDigestPort } from './ports/matrixCorpusRepository.js';
import type {
  MatrixCorpusKeyedDigestPort,
  MatrixCorpusSha256Port,
} from './types.js';

export function createMatrixCorpusKeyedDigests(key: string): MatrixCorpusKeyedDigestPort {
  return {
    digest(domain, parts): string {
      const hmac = createHmac('sha256', key);
      hmac.update(domain, 'utf8');
      hmac.update(Buffer.from([0]));
      for (const part of parts) {
        const bytes = Buffer.from(part, 'utf8');
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(bytes.length);
        hmac.update(length);
        hmac.update(bytes);
      }
      return hmac.digest('hex');
    },
  };
}

export function createMatrixCorpusSha256(): MatrixCorpusSha256Port {
  return {
    digestCanonical(canonicalJson): string {
      return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
    },
  };
}

export function createMatrixCorpusReplayProjectionDigest(): MatrixCorpusReplayProjectionDigestPort {
  return {
    digest(projection): string {
      return createHash('sha256')
        .update(stableJson(projection), 'utf8')
        .digest('hex');
    },
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite Matrix corpus projection number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value !== 'object') throw new TypeError('Unsupported Matrix corpus projection value');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}
