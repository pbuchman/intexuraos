import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const runbookPath = resolve(repoRoot, 'docs/operations/dev-hibernation.md');
const runbook = readFileSync(runbookPath, 'utf8');

describe('DEV hibernation application runbook', () => {
  it('cross-links the host owner and accepted plan without depending on chat history', () => {
    expect(runbook).toContain(
      'https://github.com/pbuchman/pbuchman-dev/blob/main/machine-setup/dev-hibernation.md'
    );
    expect(runbook).toContain('docs/superpowers/plans/2026-08-27-intexuraos-dev-hibernation.md');
    expect(runbook).toContain('addc4965d21e9fdfcf2248a0896eb07e0ed1042be219071a9d5dcbc8bcfefcdb');
  });

  it('pins Chrome Computer Use and forbids browser substitution or extension installation', () => {
    expect(runbook).toContain('Google Chrome (`com.google.Chrome`)');
    expect(runbook).toContain('Do not use Safari, install an extension');
    expect(runbook).toContain('kontakt@pbuchman.com');
  });

  it('keeps internal resume separate from the confirmed public ingress cutover', () => {
    expect(runbook).toMatch(
      /Internal runtime recovery and public ingress\s+activation are separate/u
    );
    expect(runbook).toContain('M10.1 confirmation');
    expect(runbook).toContain('M10.2 confirmation');
    expect(runbook).toMatch(/leaves `MODE=resuming` and the hibernated\s+public profile selected/u);
    expect(runbook).toContain('Never claim `MODE=hibernated`');
  });

  it('defines signed independent drain evidence and fail-closed unknown handling', () => {
    expect(runbook).toContain('witness → anchor → read1 → read2');
    expect(runbook).toMatch(/Each health\s+and ownership observation is collected inside/u);
    expect(runbook).toContain('final signed aggregate must bind');
    expect(runbook).toMatch(/missing state\s+file/u);
    expect(runbook).toContain('unknownCount=0');
    expect(runbook).toContain('`evidenceRunId`');
    expect(runbook).toContain('`operationNonce`');
    expect(runbook).toContain('exactly the signed read2 completion time');
    expect(runbook).toMatch(/Unsigned legacy\s+zero-work JSON is invalid/u);
    expect(runbook).toContain('consumes the operation nonce exactly once');
  });

  it('closes ingress and pauses producers before starting the signed zero-work proof', () => {
    const m8 = runbook.slice(runbook.indexOf('## M8'), runbook.indexOf('## M9'));
    const drainingIndex = m8.indexOf('Select and verify the reviewed `draining` profile');
    const pauseIndex = m8.indexOf('Pause every inventoried DEV-only producer');
    const witnessIndex = m8.indexOf('Capture a fresh signed freeze-boundary witness');
    const hibernateIndex = m8.indexOf('Execute `hibernate`');

    expect(drainingIndex).toBeGreaterThanOrEqual(0);
    expect(pauseIndex).toBeGreaterThan(drainingIndex);
    expect(witnessIndex).toBeGreaterThan(pauseIndex);
    expect(hibernateIndex).toBeGreaterThan(witnessIndex);
    expect(m8).toContain('Any producer-state change invalidates the entire proof');
    expect(m8).toContain('`devDrainNodeVersion`');
    expect(m8).toContain('`devDrainNodeSha256`');
    expect(m8).toContain('`devDrainVerifierSources`');
  });

  it('requires the exact release order through observation and re-hibernation', () => {
    const orderedHeadings = [
      '### M3',
      '### M4',
      '### M5',
      '### M6',
      '### M7',
      '## M8',
      '## M9',
      '## M10',
      '## M11',
    ];
    let previousIndex = -1;
    for (const heading of orderedHeadings) {
      const index = runbook.indexOf(heading);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(runbook).toContain('24 continuous hours');
    expect(runbook).toContain('DEV is again hibernated');
  });

  it('activates frozen drain telemetry before every M7 cutover mutation', () => {
    const m7 = runbook.slice(runbook.indexOf('### M7'), runbook.indexOf('## M8'));
    const telemetryIndex = m7.indexOf('#### M7.0');
    const matrixIndex = m7.indexOf('#### M7.1');
    const productionIndex = m7.indexOf('#### M7.2');
    const orchestratorIndex = m7.indexOf('#### M7.3');
    const legacyRouteIndex = m7.indexOf('#### M7.4');

    expect(telemetryIndex).toBeGreaterThanOrEqual(0);
    expect(matrixIndex).toBeGreaterThan(telemetryIndex);
    expect(productionIndex).toBeGreaterThan(matrixIndex);
    expect(orchestratorIndex).toBeGreaterThan(productionIndex);
    expect(legacyRouteIndex).toBeGreaterThan(orchestratorIndex);
    expect(m7).toContain('M7.0 freeze boundary');
  });

  it('documents the split M10 resume and public cutover commands', () => {
    const m10 = runbook.slice(runbook.indexOf('## M10'), runbook.indexOf('## M11'));
    const resumeIndex = m10.indexOf('intexuraos-dev-mode resume');
    const resumingIndex = m10.indexOf('MODE=resuming');
    const cutoverIndex = m10.indexOf('intexuraos-dev-mode cutover');

    expect(resumeIndex).toBeGreaterThanOrEqual(0);
    expect(resumingIndex).toBeGreaterThan(resumeIndex);
    expect(cutoverIndex).toBeGreaterThan(resumingIndex);
    expect(m10).toContain('--last-good-manifest "$LAST_GOOD_MANIFEST"');
    expect(m10).toContain('export LAST_GOOD_SHA256=');
    expect(m10.match(/--last-good-manifest "\$LAST_GOOD_MANIFEST"/gu)).toHaveLength(4);
    expect(m10.match(/--last-good-manifest-sha256 "\$LAST_GOOD_SHA256"/gu)).toHaveLength(4);
    expect(m10).toContain('--mode active-post-cutover');
    expect(m10).toContain('--confirm-public-activation');
    expect(m10).toContain('--dry-run');
    expect(m10).toMatch(/From\s+`MODE=resuming`, keep the hibernated profile selected/u);
    expect(m10).toMatch(/From `MODE=active-post-cutover`, execute `drain`/u);
    expect(m10).not.toContain('Bootstrap Pub/Sub exactly once');
  });

  it('keeps controller evidence under the protected host root and local evidence archival-only', () => {
    expect(runbook).toContain(
      'export HOST_EVIDENCE_ROOT="/var/lib/intexuraos-dev/evidence/$EVIDENCE_RUN_ID"'
    );
    expect(runbook).toContain(
      'export OPERATOR_EVIDENCE_ROOT="$HOME/.local/state/intexuraos/dev-hibernation/$EVIDENCE_RUN_ID"'
    );
    expect(runbook).toContain('controller-consumed artifact');
    expect(runbook).toContain('never pass a path below `$OPERATOR_EVIDENCE_ROOT`');
    expect(runbook).toMatch(/at\s+least 20 seconds[\s\S]*file_match\.sync_period = "10s"/u);
    expect(runbook).toContain(
      'export LAST_GOOD_MANIFEST="$HOST_EVIDENCE_ROOT/last-good-active-state.json"'
    );
  });

  it('requires real host validation and the tracked edge-profile gate', () => {
    expect(runbook).toContain('pnpm run verify:dev-edge-profiles');
    expect(runbook).toContain('real disposable Linux/systemd+Caddy');
    expect(runbook).toContain('Fake command fixtures alone do not satisfy');
  });
});
