import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { userInfo } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateCredentialMode } from '../../../infra/services/systemdTaskCredential.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ lstatSync: vi.fn(), realpathSync: vi.fn() }));

const directory = '/run/credentials/intexuraos-home-prod-code-agent.service';
const file = directory + '/signing.pem';
const uid = userInfo().uid;
function mode(uid: number, gid: number, mode: number): Stats {
  return { uid, gid, mode } as Stats;
}
function setup(): void {
  vi.stubEnv('CREDENTIALS_DIRECTORY', directory);
  vi.mocked(lstatSync).mockReturnValue(mode(0, 0, 0o755));
  vi.mocked(realpathSync).mockReturnValue(directory);
}
const acl = (right: string): string =>
  [`user::${right}`, `user:${String(uid)}:${right}`, 'group::---', `mask::${right}`, 'other::---'].join('\n');

describe('private task credential permissions', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it('accepts owner-only modes and rejects another owner', () => {
    expect(privateCredentialMode(file, mode(uid, 0, 0o600), false)).toBe(true);
    expect(privateCredentialMode(file, mode(0, 0, 0o400), false)).toBe(true);
    expect(privateCredentialMode(file, mode(uid + 100, 0, 0o600), false)).toBe(false);
  });
  it('accepts only systemd’s named service UID grant on its protected mount', () => {
    setup();
    vi.mocked(execFileSync).mockReturnValue(acl('r-x'));
    expect(privateCredentialMode(directory, mode(0, 0, 0o550), true)).toBe(true);
    vi.mocked(execFileSync).mockReturnValue(acl('r--'));
    expect(privateCredentialMode(file, mode(0, 0, 0o440), false)).toBe(true);
    vi.mocked(execFileSync).mockReturnValue(acl('r--') + '\nuser:12345:r--');
    expect(privateCredentialMode(file, mode(0, 0, 0o440), false)).toBe(false);
  });
  it('rejects lookalike directories, links, unsafe parents and group-readable ordinary files', () => {
    setup();
    for (const metadata of [mode(uid + 100, 0, 0o440), mode(0, 1, 0o440), mode(0, 0, 0o444)]) {
      expect(privateCredentialMode(file, metadata, false)).toBe(false);
    }
    expect(privateCredentialMode('/tmp/key', mode(0, 0, 0o440), false)).toBe(false);
    vi.stubEnv('CREDENTIALS_DIRECTORY', '/tmp');
    expect(privateCredentialMode('/tmp/key', mode(0, 0, 0o440), false)).toBe(false);
    setup();
    vi.mocked(realpathSync).mockReturnValue('/run/untrusted');
    expect(privateCredentialMode(file, mode(0, 0, 0o440), false)).toBe(false);
    vi.mocked(realpathSync).mockReturnValue(directory);
    for (const metadata of [mode(uid + 100, 0, 0o755), mode(0, 0, 0o777)]) {
      vi.mocked(lstatSync).mockReturnValue(metadata);
      expect(privateCredentialMode(file, mode(0, 0, 0o440), false)).toBe(false);
    }
    expect(execFileSync).toHaveBeenCalledTimes(0);
  });
});
