import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const docker = (...args) => execute('docker', args, { maxBuffer: 4 * 1024 * 1024 });
const tool = fileURLToPath(new URL('../', import.meta.url));
const fixtureSha = 'f'.repeat(40);
const image = process.env.MATRIX_SYNC_TEST_IMAGE ?? 'intexuraos-matrix-sync:fixture';
const fixtureUser = `${process.getuid()}:${process.getgid()}`;

async function until(fn) {
  const deadline = Date.now() + 15_000;
  let lastError;
  do {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw lastError;
}

test(
  'built image preserves health/auth, TLS, restart continuity and isolated recovery',
  { timeout: 180_000 },
  async (t) => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'matrix-image-'));
    const suffix = `${process.pid}-${Date.now()}`;
    const network = `matrix-fixture-${suffix}`;
    const matrix = `matrix-fixture-core-${suffix}`;
    const consumer = `matrix-fixture-consumer-${suffix}`;
    const containers = new Set();
    t.after(async () => {
      for (const container of containers) await docker('rm', '--force', container).catch(() => {});
      await docker('network', 'rm', network).catch(() => {});
      await fsp.rm(directory, { recursive: true, force: true });
    });
    await docker(
      'build',
      '--build-arg',
      `SOURCE_SHA=${fixtureSha}`,
      '--build-arg',
      'FIXTURE_BUILD=true',
      '--tag',
      image,
      tool
    );
    const imageInfo = JSON.parse((await docker('image', 'inspect', image)).stdout)[0];
    assert.equal(imageInfo.Config.Labels['org.opencontainers.image.revision'], fixtureSha);
    assert.equal(imageInfo.Config.Labels['com.intexuraos.build.fixture'], 'true');
    assert.equal(imageInfo.Config.Healthcheck.Interval, 30_000_000_000);
    assert.equal(imageInfo.Config.Healthcheck.StartPeriod, 120_000_000_000);
    const versions = await docker(
      'run',
      '--rm',
      '--network',
      'none',
      image,
      'node',
      '-e',
      'console.log(JSON.stringify({node:process.version,google:require("google-auth-library/package.json").version}))'
    );
    assert.deepEqual(JSON.parse(versions.stdout), { node: 'v22.23.3', google: '10.9.1' });

    // Exercise the existing media, relation, identity, recovery and outbound suites
    // against modules inside the built image; only fixture test files are mounted.
    const fixtureTests = path.join(directory, 'tests');
    await fsp.mkdir(fixtureTests);
    for (const filename of [
      'server.test.mjs',
      'backfill-private-events.test.mjs',
      'health.test.mjs',
    ]) {
      let contents = await fsp.readFile(path.join(tool, 'src', filename), 'utf8');
      contents = contents
        .replaceAll("'./server.mjs'", "'/app/src/server.mjs'")
        .replaceAll("'./backfill-private-events.mjs'", "'/app/src/backfill-private-events.mjs'")
        .replaceAll("'./healthcheck.mjs'", "'/app/src/healthcheck.mjs'");
      await fsp.writeFile(path.join(fixtureTests, filename), contents);
    }
    const suites = await docker(
      'run',
      '--rm',
      '--network',
      'none',
      '--mount',
      `type=bind,src=${fixtureTests},dst=/fixture-tests,readonly`,
      image,
      'node',
      '--test',
      '/fixture-tests/server.test.mjs',
      '/fixture-tests/backfill-private-events.test.mjs',
      '/fixture-tests/health.test.mjs'
    );
    assert.match(suites.stdout, /# fail 0/);

    const cert = path.join(directory, 'root.crt');
    const key = path.join(directory, 'root.key');
    await execute('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=matrix-fixture',
      '-addext',
      'subjectAltName=DNS:matrix-fixture',
    ]);
    await execute('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(directory, 'unrelated-root.key'),
      '-out',
      path.join(directory, 'unrelated-root.crt'),
      '-days',
      '1',
      '-subj',
      '/CN=unrelated-fixture-ca',
    ]);
    await fsp.writeFile(path.join(directory, 'matrix-token'), 'fixture-matrix-token');
    await fsp.writeFile(path.join(directory, 'bearer'), 'fixture-bearer');
    await fsp.writeFile(path.join(directory, 'google.json'), '{}');
    await fsp.writeFile(path.join(directory, 'mode'), 'quiet');
    const stateDirectory = path.join(directory, 'data');
    await fsp.mkdir(stateDirectory);
    await fsp.writeFile(
      path.join(stateDirectory, 'state.json'),
      JSON.stringify({ nextBatch: 's0', updatedAt: '2026-09-16T14:01:09.437Z' })
    );
    await fsp.writeFile(
      path.join(stateDirectory, 'pending-media.json'),
      '{"version":1,"items":[]}'
    );
    await fsp.writeFile(
      path.join(directory, 'matrix.mjs'),
      `
import https from 'node:https';
import fs from 'node:fs';
let sequence = 0;
https.createServer({cert:fs.readFileSync('/fixture/root.crt'),key:fs.readFileSync('/fixture/root.key')}, (request,response)=>{
  const url = new URL(request.url, 'https://matrix-fixture');
  const mode = fs.readFileSync('/fixture/mode','utf8');
  fs.appendFileSync('/fixture/polls', JSON.stringify({since:url.searchParams.get('since'), mode})+'\\n');
  setTimeout(()=>{
    response.setHeader('content-type','application/json');
    if(request.headers.authorization !== 'Bearer fixture-matrix-token') { response.writeHead(401); response.end('{}'); return; }
    if(mode === 'fail') { response.writeHead(503); response.end('{}'); return; }
    response.end(JSON.stringify({next_batch:'s'+(++sequence),rooms:mode === 'limited' ? {join:{'!fixture:home-dev':{timeline:{limited:true,events:[]}}}} : {}}));
  },100);
}).listen(8443,'0.0.0.0');
`
    );
    await docker('network', 'create', '--internal', network);
    containers.add(matrix);
    await docker(
      'run',
      '--detach',
      '--name',
      matrix,
      '--user',
      fixtureUser,
      '--network',
      network,
      '--network-alias',
      'matrix-fixture',
      '--mount',
      `type=bind,src=${directory},dst=/fixture`,
      image,
      'node',
      '/fixture/matrix.mjs'
    );
    const before = JSON.parse((await docker('inspect', matrix)).stdout)[0];
    const launch = async (caPath = '/fixture/root.crt') => {
      containers.add(consumer);
      const args = [
        'run',
        '--detach',
        '--name',
        consumer,
        '--user',
        fixtureUser,
        '--network',
        network,
        '--mount',
        `type=bind,src=${directory},dst=/fixture,readonly`,
        '--mount',
        `type=bind,src=${stateDirectory},dst=/data`,
        '-e',
        'MATRIX_HOMESERVER_URL=https://matrix-fixture:8443',
        '-e',
        'MATRIX_ACCESS_TOKEN_FILE=/fixture/matrix-token',
        '-e',
        'MATRIX_OUTBOUND_AUTH_TOKEN_FILE=/fixture/bearer',
        '-e',
        'INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE=/fixture/google.json',
        '-e',
        'WHATSAPP_SYNC_RETRY_DELAY_MS=100',
      ];
      if (caPath !== null) args.push('-e', `NODE_EXTRA_CA_CERTS=${caPath}`);
      await docker(...args, image);
    };
    const health = async (authorization = 'Bearer fixture-bearer') =>
      JSON.parse(
        (
          await docker(
            'exec',
            consumer,
            'node',
            '--input-type=module',
            '-e',
            `const r=await fetch('http://127.0.0.1:8099/health',{headers:{authorization:${JSON.stringify(authorization)}}});console.log(JSON.stringify({status:r.status,body:await r.json()}));`
          )
        ).stdout
      );
    await launch();
    await until(async () => assert.equal((await health()).status, 200));
    assert.equal((await health('bad')).status, 401);
    await docker('exec', consumer, 'node', '/app/src/healthcheck.mjs');
    const firstCheckpoint = JSON.parse(
      await fsp.readFile(path.join(stateDirectory, 'state.json'), 'utf8')
    );
    await docker('stop', consumer);
    await docker('rm', consumer);
    const pollsBefore = (await fsp.readFile(path.join(directory, 'polls'), 'utf8'))
      .trim()
      .split('\n').length;
    const stoppedCheckpoint = JSON.parse(
      await fsp.readFile(path.join(stateDirectory, 'state.json'), 'utf8')
    );
    assert.notEqual(firstCheckpoint.nextBatch, 's0');
    await launch();
    await until(async () => assert.equal((await health()).status, 200));
    const polls = (await fsp.readFile(path.join(directory, 'polls'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(polls[pollsBefore].since, stoppedCheckpoint.nextBatch);
    await fsp.writeFile(path.join(directory, 'mode'), 'fail');
    await until(async () => assert.equal((await health()).body.state, 'error'));
    const failedCheckpoint = await fsp.readFile(path.join(stateDirectory, 'state.json'));
    await fsp.writeFile(path.join(directory, 'mode'), 'limited');
    await until(async () => assert.equal((await health()).body.state, 'recovery_required'));
    assert.deepEqual(await fsp.readFile(path.join(stateDirectory, 'state.json')), failedCheckpoint);
    await assert.rejects(docker('exec', consumer, 'node', '/app/src/healthcheck.mjs'));
    await docker('stop', consumer);
    await docker('rm', consumer);
    await fsp.writeFile(path.join(directory, 'mode'), 'quiet');
    await launch(null);
    await until(async () => assert.equal((await health()).body.state, 'error'));
    assert.deepEqual(await fsp.readFile(path.join(stateDirectory, 'state.json')), failedCheckpoint);
    await docker('stop', consumer);
    await docker('rm', consumer);
    await launch('/fixture/unrelated-root.crt');
    await until(async () => assert.equal((await health()).body.state, 'error'));
    assert.equal((await health()).status, 503);
    const wrongCaProbe = await docker(
      'exec',
      consumer,
      'node',
      '--input-type=module',
      '-e',
      'try { await fetch("https://matrix-fixture:8443/_matrix/client/versions"); process.exitCode=1; } catch(error) { console.log(error.cause?.code ?? error.name); }'
    );
    assert.match(
      wrongCaProbe.stdout,
      /DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY/
    );
    assert.deepEqual(await fsp.readFile(path.join(stateDirectory, 'state.json')), failedCheckpoint);
    await docker('stop', consumer);
    await docker('rm', consumer);
    await fsp.writeFile(path.join(stateDirectory, 'recovery-required'), 'fixture-fence');
    const countBeforeFence = (await fsp.readFile(path.join(directory, 'polls'), 'utf8'))
      .trim()
      .split('\n').length;
    await launch();
    await until(async () => assert.equal((await health()).body.state, 'recovery_required'));
    assert.equal(
      (await fsp.readFile(path.join(directory, 'polls'), 'utf8')).trim().split('\n').length,
      countBeforeFence
    );
    const after = JSON.parse((await docker('inspect', matrix)).stdout)[0];
    assert.equal(after.Id, before.Id);
    assert.equal(after.RestartCount, before.RestartCount);
    t.diagnostic(
      'fixture image: Node22.23.3/google-auth10.9.1; built-module regression suites; trusted/missing/wrong CA TLS; HTTP401/200/503; limited/failing polls; restart cursor continuity; recovery fence; core identity/restart isolation'
    );
  }
);
