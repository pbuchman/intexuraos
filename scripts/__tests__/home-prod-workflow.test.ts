import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
const ci = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

describe('Home PROD workflow admission', () => {
  it('signs the manual Home PROD request on a GitHub-hosted runner', () => {
    expect(workflow).toContain("inputs.target == 'home-prod'");
    expect(workflow).not.toContain('self-hosted');
    expect(workflow).not.toContain('/usr/local/sbin/intexuraos-home-prod-deploy');
    expect(workflow).toContain('attestations: write');
    expect(workflow).toContain('deployments: write');
    expect(workflow).toContain('auto_merge: false');
    expect(workflow).toContain('"$GITHUB_RUN_ATTEMPT" "$deployment_id"');
    expect(workflow).toContain('uses: actions/attest@');
    expect(workflow).toContain('subject-path: home-prod.intent');
    expect(workflow).toContain('"$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"');
    expect(workflow).toContain('refs/heads/development');
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
