import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');

const devHibernation = read('docs/operations/dev-hibernation.md');
const runtimeStartGuard = read('scripts/assert-home-dev-runtime-start.mjs');
const callbackOwnership = read('docs/operations/orchestrator-identity-decision.md');
const codeTaskSkills = [read('.codex/skills/debug-code-task/SKILL.md')];
const sessionSkills = [read('.codex/skills/debug-intex-session/SKILL.md')];
const orchestratorReadme = read('workers/orchestrator/README.md');
const currentIntegrationDocs = {
  cloudBuild: read('docs/setup/03-cloud-build-trigger.md'),
  cloudRun: read('docs/setup/04-cloud-run-services.md'),
  githubOauth: read('docs/setup/13-github-oauth.md'),
  googleOauth: read('docs/setup/14-google-calendar-oauth.md'),
  internalAuthRotation: read('docs/runbooks/internal-auth-rotation.md'),
  internalOidc: read('docs/architecture/internal-oidc-phase-two.md'),
  linear: read('docs/setup/12-linear-integration.md'),
  localDev: read('docs/setup/05-local-dev-with-gcp-deps.md'),
  matrixSync: read('docs/setup/16-private-whatsapp-matrix-sync.md'),
  mobile: read('docs/setup/08-mobile-notifications-xiaomi.md'),
  orchestratorIdentity: read('docs/operations/orchestrator-identity-decision.md'),
  runtimeConfiguration: read('docs/operations/runtime-configuration.md'),
  secretPackages: read('docs/operations/secret-packages.md'),
  sentry: read('docs/operations/sentry-code-task-automation.md'),
  secretExposureArchive: read('docs/operations/secret-exposure-final-cutover-plan.md'),
  staticAssets: read('docs/architecture/static-assets-hosting.md'),
  web: read('docs/services/web/tutorial.md'),
};

describe('DEV hibernation instruction contract', () => {
  it('defines DEV as a retained, normally hibernated configuration label', () => {
    expect(currentIntegrationDocs.localDev).toMatch(/retained DEV[\s\S]*normally hibernated/iu);
    expect(devHibernation).toContain('| Final state | `hibernated` | stopped and disabled');
    expect(devHibernation).toContain('`503`, no upstream');
  });

  it('defines Home Dev as a production-owned worker host and forbids implicit resurrection', () => {
    for (const source of [currentIntegrationDocs.localDev, orchestratorReadme]) {
      expect(source).toMatch(/Home Dev[^\n]*production-owned worker host/iu);
    }
    expect(devHibernation).toContain('intexuraos-dev-mode');
    expect(devHibernation).not.toContain('pushing to `development` automatically updates');
    expect(runtimeStartGuard).toContain('/var/lib/intexuraos-dev/runtime-mode.env');
    expect(runtimeStartGuard).not.toContain(
      'During active incidents on dev environments: rebuild images, restart services'
    );
  });

  it('makes production the owner of all new code-task callbacks', () => {
    expect(callbackOwnership).toContain('production-owned code-task worker');
    expect(callbackOwnership).toContain('https://intexuraos.cloud/api/code');
    expect(codeTaskSkills[0]).toContain('public production callbacks use');
    expect(codeTaskSkills[0]).toContain('https://intexuraos.cloud/api/code');
  });

  it('keeps legacy DEV URLs as historical inputs in Codex investigation skills', () => {
    for (const skill of [...codeTaskSkills, ...sessionSkills]) {
      expect(skill).toMatch(/dev\.intexuraos\.cloud[^\n]*(?:historical|legacy)/iu);
      expect(skill).toMatch(/not a live DEV application runtime/iu);
      expect(skill).not.toContain('`dev.intexuraos.cloud` = dev');
    }
  });

  it('keeps workerLocation separate from callback ownership in the code-task skill', () => {
    for (const skill of codeTaskSkills) {
      expect(skill).toMatch(/workerLocation[^\n]*(?:execution placement|machine)/u);
      expect(skill).toMatch(/never determines callback ownership/iu);
    }
  });

  it('does not present hibernated DEV endpoints as normal integration or verification targets', () => {
    for (const source of [
      currentIntegrationDocs.linear,
      currentIntegrationDocs.mobile,
      currentIntegrationDocs.sentry,
    ]) {
      expect(source).toMatch(/retained DEV recovery/iu);
      expect(source).toMatch(/production/iu);
      expect(source).toMatch(/hibernated/iu);
    }

    for (const source of [currentIntegrationDocs.githubOauth, currentIntegrationDocs.googleOauth]) {
      expect(source).toMatch(/retained DEV recovery/iu);
      expect(source).toContain('curl -X POST https://intexuraos.cloud/');
      expect(source).not.toContain('curl -X POST https://dev.intexuraos.cloud/');
    }

    expect(currentIntegrationDocs.web).toMatch(/temporarily resumed retained DEV/iu);
    expect(currentIntegrationDocs.internalOidc).toMatch(
      /temporarily resumed retained DEV profile/iu
    );
    expect(currentIntegrationDocs.cloudBuild).toMatch(/does not (?:deploy|start) Home Dev/iu);
    expect(currentIntegrationDocs.cloudRun).toMatch(/historical reference/iu);
    expect(currentIntegrationDocs.cloudRun).toMatch(/manual exact-SHA production/iu);
    expect(currentIntegrationDocs.orchestratorIdentity).toMatch(
      /production Matrix adapter now uses the production-owned hostname/iu
    );
    expect(currentIntegrationDocs.orchestratorIdentity).not.toMatch(
      /production Matrix adapter occurrence is temporarily owned by M4\.1/iu
    );
    expect(currentIntegrationDocs.matrixSync).toContain(
      'https://matrix-outbound.intexuraos.cloud/api/matrix-outbound'
    );
    expect(currentIntegrationDocs.matrixSync).not.toContain(
      'such as an HTTPS endpoint on the Matrix host'
    );
  });

  it('does not describe Home Dev application processes as an always-running DEV environment', () => {
    expect(currentIntegrationDocs.localDev).toMatch(/Home Dev is a production-owned worker host/iu);
    expect(currentIntegrationDocs.localDev).toMatch(/retained DEV[\s\S]*normally hibernated/iu);
    expect(currentIntegrationDocs.localDev).not.toContain(
      'dev runs from the deployed checkout on `home-dev`'
    );

    for (const source of [currentIntegrationDocs.githubOauth, currentIntegrationDocs.googleOauth]) {
      expect(source).toMatch(/Do not restart `user-service` while DEV is hibernated/iu);
      expect(source).toMatch(/explicitly authorized resume/iu);
    }

    expect(currentIntegrationDocs.runtimeConfiguration).toMatch(
      /home-dev PM2 \(retained DEV recovery\)/iu
    );
    expect(currentIntegrationDocs.runtimeConfiguration).toMatch(
      /home-dev orchestrator \(production-owned\)/iu
    );
    expect(currentIntegrationDocs.runtimeConfiguration).toMatch(
      /Do not start or restart the retained DEV PM2 stack while the mode is `draining` or `hibernated`/iu
    );
    expect(currentIntegrationDocs.runtimeConfiguration).not.toMatch(
      /final destructive cleanup is governed only by/iu
    );
    expect(currentIntegrationDocs.secretPackages).toMatch(/Render And Stage Retained DEV/iu);
    expect(currentIntegrationDocs.secretPackages).toMatch(
      /Normal completion leaves the DEV\s+application profile hibernated/iu
    );
    expect(currentIntegrationDocs.secretPackages).not.toMatch(
      /cutover itself is governed only by/iu
    );
    expect(currentIntegrationDocs.internalAuthRotation).toMatch(
      /stage the same SHA on Home Dev\s+without starting the retained DEV application stack/iu
    );
    expect(currentIntegrationDocs.internalAuthRotation).toMatch(
      /final Home Dev application mode is `hibernated`/iu
    );
    expect(orchestratorReadme).toMatch(/production-owned Home Dev worker/iu);
    expect(orchestratorReadme).toMatch(/exact reviewed artifact/iu);
    expect(orchestratorReadme).not.toContain(
      'This is automated by the webhook handler on pushes to development.'
    );
    expect(currentIntegrationDocs.secretExposureArchive).toMatch(
      /Status: historical archive; do not execute/iu
    );
    expect(currentIntegrationDocs.secretExposureArchive).toMatch(
      /current DEV hibernation runbook\]\([^)]*\) is the operational\s+authority/iu
    );
    expect(currentIntegrationDocs.staticAssets).toMatch(/A push does not publish assets/iu);
    expect(currentIntegrationDocs.staticAssets).toMatch(/explicit\s+reviewed manual operation/iu);
    expect(currentIntegrationDocs.staticAssets).not.toContain(
      'Cloud Build automatically syncs assets'
    );
  });
});
