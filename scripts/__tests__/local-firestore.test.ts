import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLocalEmulatorStartPlan } from '../lib/local-emulator-lifecycle.mjs';

const root = resolve(__dirname, '../..');
const fixtures: string[] = [];
const processes: ChildProcess[] = [];

afterEach(() => {
  for (const child of processes.splice(0)) {
    // Kill the fixture's process group, including the fake emulator, on assertion failure.
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

interface FixtureProcess {
  child: ChildProcess;
  finished: Promise<{ code: number | null; signal: string | null; stderr: string }>;
  ready: () => Promise<string[]>;
}

function createFixture(): {
  directory: string;
  data: string;
  start: (failExport?: boolean) => FixtureProcess;
  seed: () => string;
} {
  const directory = mkdtempSync('/var/tmp/local-firestore-');
  fixtures.push(directory);
  const data = join(directory, 'data');
  const bin = join(directory, 'bin');
  mkdirSync(data);
  mkdirSync(bin);
  // Relocate only the volume mount. Execute the real wrapper's control flow unchanged.
  const script = join(directory, 'start.sh');
  writeFileSync(
    script,
    readFileSync(resolve(root, 'docker/firestore/start.sh'), 'utf8').replaceAll(
      '/data/',
      `${data}/`
    )
  );
  writeFileSync(
    join(bin, 'java'),
    `#!${process.execPath}
const fs = require('node:fs');
process.on('SIGTERM', () => {
  fs.writeFileSync(process.env.FIXTURE + '/stopped', 'yes');
  process.exit(0);
});
fs.writeFileSync(process.env.FIXTURE + '/args.json', JSON.stringify(process.argv.slice(2)));
setInterval(() => {}, 1000);
`,
    { mode: 0o755 }
  );
  writeFileSync(
    join(bin, 'curl'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const body = JSON.parse(args[args.indexOf('-d') + 1]);
fs.writeFileSync(process.env.FIXTURE + '/export.json', JSON.stringify({ args, body }));
const target = body.export_directory + '/' + body.export_name;
fs.mkdirSync(target);
fs.writeFileSync(target + '/firestore.overall_export_metadata', 'new snapshot');
process.exit(process.env.FAIL_EXPORT === '1' ? 22 : 0);
`,
    { mode: 0o755 }
  );

  function start(failExport = false): FixtureProcess {
    rmSync(join(directory, 'args.json'), { force: true });
    rmSync(join(directory, 'stopped'), { force: true });
    const child = spawn('/bin/sh', [script], {
      detached: true,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        FIXTURE: directory,
        FAIL_EXPORT: failExport ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processes.push(child);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const finished = new Promise<{ code: number | null; signal: string | null; stderr: string }>(
      (resolveExit, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolveExit({ code, signal, stderr }));
      }
    );
    return {
      child,
      finished,
      async ready(): Promise<string[]> {
        await vi.waitFor(() => expect(existsSync(join(directory, 'args.json'))).toBe(true));
        return JSON.parse(readFileSync(join(directory, 'args.json'), 'utf8')) as string[];
      },
    };
  }

  function seed(): string {
    const previous = join(data, 'previous');
    mkdirSync(previous);
    writeFileSync(join(previous, 'firestore.overall_export_metadata'), 'previous snapshot');
    symlinkSync(previous, join(data, 'current'));
    return previous;
  }
  return { directory, data, start, seed };
}

describe('Message Digest local Firestore', () => {
  it('starts healthy Firestore alongside Pub/Sub before bootstrapping the bridge', () => {
    expect(buildLocalEmulatorStartPlan()[0]).toEqual([
      'up',
      '-d',
      '--wait',
      'firestore-emulator',
      'pubsub-emulator',
    ]);
  });
  it('mounts persistent storage, requests graceful shutdown, and binds only to loopback', () => {
    const compose = readFileSync(resolve(root, 'docker/docker-compose.local.yaml'), 'utf8');
    expect(compose).toContain('127.0.0.1:8101:8101');
    expect(compose).toContain('firestore-data:/data');
    expect(compose).toContain('stop_signal: SIGTERM');
  });

  it('exports on SIGTERM and imports the latest successful snapshot after recreation', async () => {
    const fixture = createFixture();
    const first = fixture.start();
    expect((await first.ready()).some((arg) => arg.startsWith('--seed_from_export='))).toBe(false);
    first.child.kill('SIGTERM');
    expect(await first.finished).toEqual({ code: 0, signal: null, stderr: '' });
    expect(existsSync(join(fixture.directory, 'stopped'))).toBe(true);

    const current = join(fixture.data, 'current');
    const firstSnapshot = readlinkSync(current);
    expect(readFileSync(join(current, 'firestore.overall_export_metadata'), 'utf8')).toBe(
      'new snapshot'
    );
    const exported = JSON.parse(readFileSync(join(fixture.directory, 'export.json'), 'utf8')) as {
      args: string[];
      body: { database: string };
    };
    expect(exported.args).toContain(
      'http://127.0.0.1:8101/emulator/v1/projects/intexuraos-message-digest-mvp-local:export'
    );
    expect(exported.body.database).toBe(
      'projects/intexuraos-message-digest-mvp-local/databases/(default)'
    );

    const second = fixture.start();
    expect(await second.ready()).toContain(
      `--seed_from_export=${current}/firestore.overall_export_metadata`
    );
    second.child.kill('SIGTERM');
    expect(await second.finished).toEqual({ code: 0, signal: null, stderr: '' });
    expect(readlinkSync(current)).not.toBe(firstSnapshot);
    expect(readFileSync(join(firstSnapshot, 'firestore.overall_export_metadata'), 'utf8')).toBe(
      'new snapshot'
    );
  });

  it('keeps the previous snapshot after a failed export, even if partial output exists', async () => {
    const fixture = createFixture();
    const previous = fixture.seed();
    const running = fixture.start(true);
    await running.ready();
    running.child.kill('SIGTERM');
    expect(await running.finished).toMatchObject({
      code: 1,
      signal: null,
      stderr: expect.stringContaining('previous snapshot remains intact'),
    });
    expect(existsSync(join(fixture.directory, 'stopped'))).toBe(true);
    expect(readlinkSync(join(fixture.data, 'current'))).toBe(previous);
    expect(
      readFileSync(join(fixture.data, 'current/firestore.overall_export_metadata'), 'utf8')
    ).toBe('previous snapshot');
  });

  it.each(['missing metadata', 'empty metadata', 'dangling link'])(
    'rejects an existing snapshot with %s before starting the emulator',
    async (invalid) => {
      const fixture = createFixture();
      const previous = fixture.seed();
      if (invalid === 'dangling link') rmSync(previous, { recursive: true });
      else if (invalid === 'empty metadata')
        writeFileSync(join(previous, 'firestore.overall_export_metadata'), '');
      else rmSync(join(previous, 'firestore.overall_export_metadata'));

      expect(await fixture.start().finished).toMatchObject({
        code: 1,
        signal: null,
        stderr: expect.stringContaining('refusing to start empty'),
      });
      expect(existsSync(join(fixture.directory, 'args.json'))).toBe(false);
      expect(existsSync(join(fixture.directory, 'export.json'))).toBe(false);
      expect(readlinkSync(join(fixture.data, 'current'))).toBe(previous);
    }
  );
});
