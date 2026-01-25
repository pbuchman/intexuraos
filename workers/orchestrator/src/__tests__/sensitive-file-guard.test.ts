import { describe, it, expect } from 'vitest';
import { SensitiveFileGuard } from '../services/sensitive-file-guard.js';

describe.skip('SensitiveFileGuard', () => {
  it('should detect .env files as sensitive', async () => {
    const guard = new SensitiveFileGuard();
    expect(guard.isSensitive('.env')).toBe(true);
    expect(guard.isSensitive('app/.env')).toBe(true);
    expect(guard.isSensitive('app/.env.local')).toBe(true);
  });

  it('should detect credential files as sensitive', async () => {
    const guard = new SensitiveFileGuard();
    expect(guard.isSensitive('credentials.json')).toBe(true);
    expect(guard.isSensitive('serviceAccountKey.json')).toBe(true);
    expect(guard.isSensitive('secrets/secret.txt')).toBe(true);
  });

  it('should detect key files as sensitive', async () => {
    const guard = new SensitiveFileGuard();
    expect(guard.isSensitive('private.key')).toBe(true);
    expect(guard.isSensitive('id_rsa')).toBe(true);
    expect(guard.isSensitive('cert.pem')).toBe(true);
  });

  it('should allow non-sensitive files', async () => {
    const guard = new SensitiveFileGuard();
    expect(guard.isSensitive('src/index.ts')).toBe(false);
    expect(guard.isSensitive('package.json')).toBe(false);
    expect(guard.isSensitive('README.md')).toBe(false);
  });
});
