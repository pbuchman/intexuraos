import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
const ci = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

const compatibilityJob =
  workflow.split('  deploy-home-prod-compatibility:\n')[1]?.split('  deploy-home-prod:\n')[0] ?? '';
const hostedJob =
  workflow.split('  deploy-home-prod:\n')[1]?.split('  deploy-retained-gcp:\n')[0] ?? '';

describe('Home PROD workflow admission', () => {
  it('selects exactly one release path from the configured broker App ID', () => {
    expect(compatibilityJob).toContain(
      "if: ${{ inputs.target == 'home-prod' && vars.HOME_PROD_BROKER_APP_ID == '' }}"
    );
    expect(hostedJob).toContain(
      "if: ${{ inputs.target == 'home-prod' && vars.HOME_PROD_BROKER_APP_ID != '' }}"
    );
    expect(hostedJob).toContain('[[ "$HOME_PROD_BROKER_APP_ID" =~ ^[1-9][0-9]*$ ]]');
    expect(compatibilityJob).not.toMatch(/needs:|failure\(\)|always\(\)/u);
    expect(compatibilityJob).toContain('runs-on: [self-hosted, Linux, X64, builder]');
    expect(compatibilityJob).toContain('[[ "$RUNNER_NAME" == \'home-dev\' ]]');
    expect(compatibilityJob).toContain(
      'name: Deploy Home Production (transition, package ${{ vars.PROD_SECRET_PACKAGE_VERSION }})'
    );
    expect(compatibilityJob).toContain('permissions: {}');
    expect(compatibilityJob).not.toMatch(/uses:|GH_TOKEN|github\.token|sudo|gh api/u);
    expect(compatibilityJob.match(/^ {6}- name:/gmu)).toHaveLength(1);
  });

  it.each([
    { ref: 'development', pin: '5', runner: 'home-dev', gate: 0, expected: 0 },
    { ref: 'main', pin: '5', runner: 'home-dev', gate: 0, expected: 1 },
    { ref: 'development', pin: '4', runner: 'home-dev', gate: 0, expected: 1 },
    { ref: 'development', pin: '5', runner: 'other', gate: 0, expected: 1 },
    { ref: 'development', pin: '5', runner: 'home-dev', gate: 42, expected: 42 },
  ])(
    'submits the run and attempt to the host from $ref pin $pin runner $runner and returns the gate result $gate',
    ({ ref, pin, runner, gate, expected }) => {
      const step = compatibilityJob.split('      - name: Activate admitted release\n')[1];
      if (!step) throw new Error('missing host admission request');
      const client = '/usr/local/bin/intexuraos-home-prod-request';
      expect(step).toContain(`${client} "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"`);
      const shell = step.slice(step.indexOf('run: |\n') + 7).replace(client, 'fixture_request');
      const result = spawnSync(
        'bash',
        [
          '-c',
          'fixture_request() { [[ "$#" == 2 && "$1" == 91 && "$2" == 2 ]] || exit 99; echo requested; return "$FIXTURE_GATE_EXIT"; };\n' +
            shell,
        ],
        {
          env: {
            PATH: '/usr/bin:/bin',
            RUNNER_NAME: runner,
            GITHUB_REF: `refs/heads/${ref}`,
            PROD_SECRET_PACKAGE_VERSION: pin,
            GITHUB_RUN_ID: '91',
            GITHUB_RUN_ATTEMPT: '2',
            FIXTURE_GATE_EXIT: String(gate),
          },
          encoding: 'utf8',
        }
      );
      expect(result.status).toBe(expected);
      expect(result.stdout.trim()).toBe(expected === 1 ? '' : 'requested');
    }
  );

  it('rejects a malformed configured App ID before contacting GitHub', () => {
    const step = hostedJob
      .split('      - name: Prepare exact development release intent\n')[1]
      ?.split('      - name: Register Home PROD deployment')[0];
    if (!step) throw new Error('missing hosted intent admission');
    const result = spawnSync(
      'bash',
      ['-c', 'gh() { exit 42; };\n' + step.slice(step.indexOf('run: |\n') + 7)],
      {
        env: {
          PATH: '/usr/bin:/bin',
          GITHUB_REF: 'refs/heads/development',
          GITHUB_SHA: 'a'.repeat(40),
          PROD_SECRET_PACKAGE_VERSION: '5',
          HOME_PROD_BROKER_APP_ID: 'invalid',
        },
      }
    );
    expect(result.status).toBe(1);
  });

  it('signs the manual Home PROD request on a GitHub-hosted runner', () => {
    expect(hostedJob).toContain("inputs.target == 'home-prod'");
    expect(hostedJob).not.toContain('self-hosted');
    expect(hostedJob).not.toContain('/usr/local/sbin/intexuraos-home-prod-deploy');
    expect(hostedJob).toContain('attestations: write');
    expect(hostedJob).toContain('deployments: write');
    expect(hostedJob).toContain('auto_merge: false');
    expect(hostedJob).toContain('"$GITHUB_RUN_ATTEMPT" "$deployment_id"');
    expect(hostedJob).toContain('uses: actions/attest@');
    expect(hostedJob).toContain('subject-path: home-prod.intent');
    expect(hostedJob).toContain('"$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"');
    expect(hostedJob).toContain('refs/heads/development');
  });

  it('waits for the dedicated App check for this exact attempt and SHA', () => {
    expect(workflow).toContain('HOME_PROD_BROKER_APP_ID');
    expect(workflow).toContain('home-prod/${GITHUB_RUN_ID}/${GITHUB_RUN_ATTEMPT}');
    expect(workflow).toContain('.app.id == $app');
    expect(workflow).toContain('/deployments/$HOME_PROD_DEPLOYMENT_ID/statuses');
    expect(workflow).toContain('.head_sha == $sha');
    expect(workflow).toContain('.external_id == $key');
    expect(workflow).toContain('.conclusion == "success"');
  });

  it.each([
    { conclusion: 'success', app: 12, sha: 'a'.repeat(40), attempt: 2, status: 0 },
    { conclusion: 'success', app: 12, reportApp: 73, sha: 'a'.repeat(40), attempt: 2, status: 42 },
    {
      conclusion: 'success',
      app: 12,
      reportState: 'error',
      sha: 'a'.repeat(40),
      attempt: 2,
      status: 1,
    },
    { conclusion: 'failure', app: 12, sha: 'a'.repeat(40), attempt: 2, status: 1 },
    { conclusion: 'success', app: 55, sha: 'a'.repeat(40), attempt: 2, status: 42 },
    { conclusion: 'success', app: 12, sha: 'b'.repeat(40), attempt: 2, status: 42 },
    { conclusion: 'success', app: 12, sha: 'a'.repeat(40), attempt: 1, status: 42 },
  ])(
    'evaluates terminal acknowledgment $conclusion from App $app for attempt $attempt',
    (input) => {
      const step = workflow
        .split('      - name: Wait for Home PROD activation\n')[1]
        ?.split('  deploy-retained-gcp:')[0];
      if (step === undefined) throw new Error('missing acknowledgment step');
      const shell = step.slice(step.indexOf('run: |\n') + 'run: |\n'.length);
      const check = {
        app: { id: input.app, slug: 'fixture-broker' },
        external_id: `home-prod/91/${String(input.attempt)}/42`,
        name: `home-prod/91/${String(input.attempt)}/42`,
        head_sha: input.sha,
        status: 'completed',
        conclusion: input.conclusion,
      };
      const result = spawnSync(
        'bash',
        [
          '-c',
          'gh() { if [[ "$*" == *"/statuses?"* ]]; then echo "$REPORTS"; else echo "$CHECKS"; fi; }; sleep() { exit 42; };\n' +
            shell,
        ],
        {
          env: {
            PATH: '/usr/bin:/bin',
            HOME_PROD_BROKER_APP_ID: '12',
            GITHUB_REPOSITORY: 'fixture/repo',
            GITHUB_RUN_ID: '91',
            GITHUB_RUN_ATTEMPT: '2',
            GITHUB_SHA: 'a'.repeat(40),
            HOME_PROD_DEPLOYMENT_ID: '42',
            GITHUB_SERVER_URL: 'https://github.com',
            REPORTS: JSON.stringify([
              {
                state: input.reportState ?? input.conclusion,
                environment: 'home-prod',
                performed_via_github_app: { id: input.reportApp ?? 12 },
                log_url: 'https://github.com/fixture/repo/actions/runs/91/attempts/2',
              },
            ]),
            CHECKS: JSON.stringify({ check_runs: [check] }),
          },
          timeout: 3000,
        }
      );
      expect(result.status).toBe(input.status);
    }
  );

  it.each([
    { mode: 'existing', posts: 0, success: true },
    { mode: 'new', posts: 1, success: true },
    { mode: 'lost_response', posts: 1, success: true },
    { mode: 'ambiguous', posts: 0, success: false },
  ])(
    'registers a single exact deployment when the API returns $mode',
    ({ mode, posts, success }) => {
      const text = workflow
        .split('      - name: Register Home PROD deployment\n')[1]
        ?.split('      - name: Attest')[0];
      if (!text) throw new Error('registration step missing');
      const dir = mkdtempSync(join(tmpdir(), 'deployment-api-'));
      const sha = 'a'.repeat(40);
      const row = {
        id: 42,
        sha,
        ref: sha,
        task: 'home-prod-91-2',
        environment: 'home-prod',
        creator: { id: 41898282 },
        payload: { protocol: 'home-prod/v2', run_id: '91', run_attempt: '2' },
      };
      const mock = `gh() {
      if [[ "$*" == *"--method POST"* ]]; then
        cat > posted.json
        echo POST >> calls
        [[ "$MODE" != lost_response ]] || return 1
        echo 42
      elif [[ "$MODE" == ambiguous ]]; then echo "[$ROW,$ROW]"
      elif [[ "$MODE" == existing || -f posted.json ]]; then echo "[$ROW]"
      else echo '[]'; fi
    }
    sleep() { :; }
    `;
      try {
        const result = spawnSync('bash', ['-c', mock + text.slice(text.indexOf('run: |\n') + 7)], {
          cwd: dir,
          env: {
            PATH: '/usr/bin:/bin',
            MODE: mode,
            ROW: JSON.stringify(row),
            GITHUB_REPOSITORY: 'fixture/repo',
            GITHUB_ENV: join(dir, 'env'),
            GITHUB_SHA: sha,
            GITHUB_REF: 'refs/heads/development',
            PROD_SECRET_PACKAGE_VERSION: '5',
            GITHUB_RUN_ID: '91',
            GITHUB_RUN_ATTEMPT: '2',
          },
        });
        expect(result.status === 0).toBe(success);
        expect(
          existsSync(join(dir, 'calls'))
            ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').length
            : 0
        ).toBe(posts);
        if (posts) {
          expect(JSON.parse(readFileSync(join(dir, 'posted.json'), 'utf8'))).toMatchObject({
            auto_merge: false,
            required_contexts: [],
            environment: 'home-prod',
            ref: sha,
            payload: row.payload,
          });
        }
        if (success)
          expect(readFileSync(join(dir, 'home-prod.intent'), 'utf8')).toBe(
            `home-prod/v2\nfixture/repo\nrefs/heads/development\n${sha}\n5\n91\n2\n42\n`
          );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  it('keeps edge render and real nginx/JWT checks in the exact-SHA CI workflow', () => {
    expect(ci).toContain('docker build -t intexuraos-home-prod-edge-test scripts/home-prod/tests');
    expect(ci).toContain(
      'scripts/home-prod/tests/edge-render.test.mjs scripts/home-prod/tests/edge-integration.test.mjs'
    );
  });
});
