import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname } from 'node:path';

/** On Linux the group mode can represent the POSIX ACL mask for systemd's one named reader. */
export function privateCredentialMode(path: string, metadata: Stats, directory: boolean): boolean {
  const uid = userInfo().uid;
  if ((metadata.mode & 0o077) === 0) return metadata.uid === uid || metadata.uid === 0;

  const folder = directory ? path : dirname(path);
  if (
    metadata.uid !== 0 || metadata.gid !== 0 ||
    (metadata.mode & 0o777) !== (directory ? 0o550 : 0o440) ||
    folder !== process.env['CREDENTIALS_DIRECTORY'] ||
    !/^\/run\/credentials\/[A-Za-z0-9_.@:-]+\.service$/u.test(folder) ||
    realpathSync(folder) !== folder
  ) return false;
  const parent = lstatSync('/run/credentials');
  if (parent.uid !== 0 || (parent.mode & 0o022) !== 0) return false;

  const right = directory ? 'r-x' : 'r--';
  const expected = [`user::${right}`, `user:${String(uid)}:${right}`, 'group::---', `mask::${right}`, 'other::---'];
  const acl = execFileSync('/usr/bin/getfacl', ['-cpn', '--', path], {
    encoding: 'utf8', env: { LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2000, maxBuffer: 4096,
  });
  return acl.trim() === expected.join('\n');
}
