import { describe, expect, it } from 'vitest';
import {
  expectedStageActions,
  loadFinalCutoverManifest,
  validateFinalCutoverPlan,
} from '../verify-final-cutover-plan.mjs';

function plan(actions: Array<{ address: string; actions: string[] }>, outputs = {}) {
  return {
    resource_changes: actions.map((entry) => ({
      address: entry.address,
      change: { actions: entry.actions },
    })),
    output_changes: outputs,
  };
}

describe('final irreversible secret cutover Terraform contract', () => {
  const manifest = loadFinalCutoverManifest();

  it('freezes 34 legacy names and exactly 36 DEV deletes', () => {
    expect(manifest.legacySecretNames).toHaveLength(34);
    expect(new Set(manifest.legacySecretNames)).toHaveLength(34);
    const actions = expectedStageActions(manifest, 'devObsoleteDelete');
    expect(actions).toHaveLength(36);
    expect(actions.filter((entry) => entry.address.includes('module.secret_manager'))).toHaveLength(
      34
    );
    expect(actions).toContainEqual({
      address: 'google_secret_manager_secret.cloudflare_dns_api_token[0]',
      actions: ['delete'],
    });
    expect(actions).toContainEqual({
      address: 'google_apikeys_key.firebase_browser',
      actions: ['delete'],
    });
  });

  it('accepts only the exact DEV delete set with no outputs', () => {
    const actions = expectedStageActions(manifest, 'devObsoleteDelete');
    expect(
      validateFinalCutoverPlan({ manifest, plan: plan(actions), stage: 'devObsoleteDelete' })
    ).toEqual({ resourceActions: 36, outputActions: 0 });

    expect(() =>
      validateFinalCutoverPlan({
        manifest,
        plan: plan([...actions, manifest.excludedTerraformActions[0]]),
        stage: 'devObsoleteDelete',
      })
    ).toThrow('FINAL_CUTOVER_PLAN_ACTION_SET_MISMATCH');
    expect(() =>
      validateFinalCutoverPlan({
        manifest,
        plan: plan(actions, { unexpected: { actions: ['delete'] } }),
        stage: 'devObsoleteDelete',
      })
    ).toThrow('FINAL_CUTOVER_PLAN_OUTPUT_SET_MISMATCH');
  });

  it('accepts the exact Cloud Build stages and rejects broad IAM changes', () => {
    const accessor = manifest.terraformStages.cloudBuildAccessor.allowedActionSets[1];
    expect(
      validateFinalCutoverPlan({ manifest, plan: plan(accessor), stage: 'cloudBuildAccessor' })
    ).toEqual({ resourceActions: 1, outputActions: 0 });
    expect(
      validateFinalCutoverPlan({ manifest, plan: plan([]), stage: 'cloudBuildAccessor' })
    ).toEqual({ resourceActions: 0, outputActions: 0 });

    const admin = expectedStageActions(manifest, 'cloudBuildAdminDelete');
    expect(
      validateFinalCutoverPlan({ manifest, plan: plan(admin), stage: 'cloudBuildAdminDelete' })
    ).toEqual({ resourceActions: 2, outputActions: 0 });
    expect(() =>
      validateFinalCutoverPlan({
        manifest,
        plan: plan([
          ...admin,
          {
            address: 'google_project_iam_member.unrelated',
            actions: ['delete'],
          },
        ]),
        stage: 'cloudBuildAdminDelete',
      })
    ).toThrow('FINAL_CUTOVER_PLAN_ACTION_SET_MISMATCH');
  });

  it('allows only the frozen remainder and explicit App Check drift in read-only full plans', () => {
    const remaining = [
      ...expectedStageActions(manifest, 'cloudBuildAdminDelete'),
      ...expectedStageActions(manifest, 'devObsoleteDelete'),
      ...manifest.excludedTerraformActions,
    ];
    expect(
      validateFinalCutoverPlan({ manifest, plan: plan(remaining), stage: 'remaining' })
    ).toEqual({ resourceActions: remaining.length, outputActions: 0 });
    expect(() =>
      validateFinalCutoverPlan({
        manifest,
        plan: plan([{ address: 'google_storage_bucket.unrelated', actions: ['update'] }]),
        stage: 'remaining',
      })
    ).toThrow('FINAL_CUTOVER_PLAN_UNEXPECTED_ACTION');
  });

  it('allows exactly the frozen Hetzner resource and output deletion', () => {
    const actions = expectedStageActions(manifest, 'hetznerLegacyDelete');
    expect(
      validateFinalCutoverPlan({
        manifest,
        plan: plan(actions, {
          cloudflare_dns_api_token_secret_id: { actions: ['delete'] },
        }),
        stage: 'hetznerLegacyDelete',
      })
    ).toEqual({ resourceActions: 1, outputActions: 1 });
  });
});
