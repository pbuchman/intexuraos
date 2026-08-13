# Runtime Secret Manager Cleanup — Historical / Completed

> **Status: historical and completed.** This document preserves evidence of a
> one-time cleanup and is not an active runbook. Do not replay its commands,
> frozen plan, paths, checksums, counts, or deletion procedure. Current package
> lifecycle and legacy cleanup gates are defined in
> [Secret Packages Operations](./secret-packages.md).

This is the one-time destructive runbook for permanently deleting the 26
obsolete runtime-configuration secrets and their obsolete dependants. It is not
a general Terraform apply procedure. Stop on every failed gate; do not repair or
recreate resources during this run.

Project: `intexuraos-dev-pbuchman`. This legacy-named project serves dev and
production.

## Frozen Change Set

The only approved change set is **0 add / 0 change / 396 destroy**.

| Approved deletion category | Count |
| --- | ---: |
| Secret Manager containers | 26 |
| Application secret-access IAM bindings | 324 |
| Hetzner secret-access IAM bindings | 42 |
| Firebase secret versions | 3 |
| Transcription Sentry rollback IAM binding | 1 |
| **Total** | **396** |

The exact address allowlist is represented as follows:

- 26 containers are the unique union of `scopes.common`, `scopes.dev`, and
  `scopes.prod` (25 names) plus the one `deleteOnlyNames` tombstone in
  `config/environments/policy.json`.
- 324 application bindings are the Cartesian product of these 18 Terraform IAM
  resources and the 18 names present for each resource in the saved plan:
  `api_docs_hub_secrets`, `app_settings_service_secrets`,
  `bookmarks_agent_secrets`, `calendar_agent_secrets`, `code_agent_secrets`,
  `fishing_assistant_service_secrets`, `hellscript_agent_secrets`,
  `image_service_secrets`, `intex_agent_secrets`, `linear_agent_secrets`,
  `llm_usage_service_secrets`, `mobile_notifications_service_secrets`,
  `notes_agent_secrets`, `notion_service_secrets`,
  `research_agent_secrets`, `user_service_secrets`, `web_agent_secrets`, and
  `whatsapp_service_secrets`.
- 42 Hetzner bindings are the 21 names present in the saved plan for each of
  `hetzner_provisioner_runtime_secrets` and `hetzner_runtime_secrets`.
- The three versions are `firebase_api_key`, `firebase_auth_domain`, and
  `firebase_project_id`.
- The last binding is `transcription_sentry_dsn_dev`.

The approved saved artifacts are private operator-local files:

```text
/tmp/intexuraos-pr2-targeted-plan.iAIXO3/pr2-targeted.tfplan
/tmp/intexuraos-pr2-targeted-plan.iAIXO3/summary.json
```

The plan SHA-256 is
`5c87082e4e1ae827fc067b77fd5a77425ace7e3d60c301fb2a9f03a3c737083c`.
Both files must remain mode `0600`. A missing file, a different checksum, a
different state, or any plan regeneration invalidates this run. Review a new
plan from the beginning instead of applying it.

The separately inspected full plan is prohibited: it has `approved=false` and
contains four unrelated updates in addition to the 396 deletions. Never apply
it and never replace the saved targeted plan with an unqualified/full plan.

## Mandatory Gates

Run from the repository root on the operator machine. Keep outputs in the
private plan directory; never put plan/state/audit evidence in Git.

```bash
set -euo pipefail
umask 077
cleanup_dir='/tmp/intexuraos-pr2-targeted-plan.iAIXO3'
test "$(stat -f '%Lp' "${cleanup_dir}")" = '700'
```

On Linux use `stat -c '%a'` for the directory and file permission checks.

### Plan And State Gate

```bash
cleanup_plan='/tmp/intexuraos-pr2-targeted-plan.iAIXO3/pr2-targeted.tfplan'
cleanup_summary='/tmp/intexuraos-pr2-targeted-plan.iAIXO3/summary.json'
cleanup_sha='5c87082e4e1ae827fc067b77fd5a77425ace7e3d60c301fb2a9f03a3c737083c'
cleanup_actual_sha="$(shasum -a 256 "${cleanup_plan}" | awk '{print $1}')"

test "${cleanup_actual_sha}" = "${cleanup_sha}"
test "$(stat -f '%Lp' "${cleanup_plan}")" = '600'
test "$(stat -f '%Lp' "${cleanup_summary}")" = '600'

jq -e --arg sha "${cleanup_sha}" '
  .approved == true and
  .planSha256 == $sha and
  .expectedAddressCount == 396 and
  .counts == {
    add: 0, change: 0, destroy: 396, replace: 0,
    read: 0, other: 0, total: 396
  } and
  .missingAddresses == [] and
  .unexpectedAddresses == [] and
  .unexpectedActions == [] and
  .duplicates == [] and
  .outputChanges == [] and
  .stateStable == true and
  .stateBefore == .stateAfter and
  .stateBefore.lineage == "3ec4b306-c954-66a7-0173-448697cb94c9" and
  .stateBefore.serial == 945 and
  ([.changes[] | select(.actions != ["delete"])] | length) == 0 and
  ([.changes[] | select(.address | test(
    "^module\\.secret_manager\\.google_secret_manager_secret\\.secrets\\["
  ))] | length) == 26 and
  ([.changes[] | select(.address | test(
    "^module\\.iam\\.google_secret_manager_secret_iam_member\\.[^.[]+_secrets\\["
  ))] | length) == 324 and
  ([.changes[] | select(.address | test(
    "^google_secret_manager_secret_iam_member\\.hetzner_(provisioner_)?runtime_secrets\\["
  ))] | length) == 42 and
  ([.changes[] | select(.address | test(
    "^google_secret_manager_secret_version\\.firebase_(api_key|auth_domain|project_id)$"
  ))] | length) == 3 and
  ([.changes[] | select(
    .address == "google_secret_manager_secret_iam_member.transcription_sentry_dsn_dev"
  )] | length) == 1
' "${cleanup_summary}"
```

Do not weaken any assertion. Pull the live state immediately before the apply
and require the same lineage and serial:

```bash
cleanup_state='/tmp/intexuraos-pr2-targeted-plan.iAIXO3/state-before-apply.json'
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
  terraform -chdir=terraform/environments/dev state pull >"${cleanup_state}"
chmod 600 "${cleanup_state}"
jq -e '
  .lineage == "3ec4b306-c954-66a7-0173-448697cb94c9" and
  .serial == 945 and
  .terraform_version == "1.5.7"
' "${cleanup_state}"
```

If the serial changed, stop. A stale saved plan must not be applied.

### T0 And Data Access Gate

Secret Manager `DATA_READ` audit logging must be active before `T0`. Verify the
project policy contains `secretmanager.googleapis.com` with `DATA_READ`:

```bash
cleanup_project='intexuraos-dev-pbuchman'
cleanup_sa_key="$HOME/.config/gcloud/sa-key.json"
cleanup_prod_principal='ixos-hetzner-provisioner-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
cleanup_home_dev_principal='claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
cleanup_transcription_principal='ixos-transcription-fn-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
cleanup_policy='/tmp/intexuraos-pr2-targeted-plan.iAIXO3/iam-policy.json'
CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud projects get-iam-policy "${cleanup_project}" \
  --format=json >"${cleanup_policy}"
chmod 600 "${cleanup_policy}"
jq -e '
  any(.auditConfigs[]?;
    .service == "secretmanager.googleapis.com" and
    any(.auditLogConfigs[]?; .logType == "DATA_READ")
  )
' "${cleanup_policy}"
```

If this is false, stop. Enable logging through reviewed Terraform, then begin a
new observation window. Record `T0` immediately before Step 1 (merge), after
the saved plan is sealed and all deliberate plan-refresh reads have ended. The
merge automatically starts the first production deployment, so recording T0 in
Step 2 is too late.

Every plan regeneration or deliberate read of a blocked secret invalidates and
resets T0. Review and seal the replacement plan first, then record a new T0.
Do not run another plan or blocked-secret probe before the pre-apply audit gate.

```bash
cleanup_t0="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf '%s\n' "${cleanup_t0}" \
  >'/tmp/intexuraos-pr2-targeted-plan.iAIXO3/T0'
chmod 600 '/tmp/intexuraos-pr2-targeted-plan.iAIXO3/T0'
```

Derive the exact blocked and retained sets from policy. Do not hand-maintain
them. The unique scope union must contain 25 names, adding the tombstone must
produce exactly 26, and the retained policy set must contain exactly 37:

```bash
cleanup_blocked_names="${cleanup_dir}/blocked-names.txt"
cleanup_retained_names="${cleanup_dir}/retained-names.txt"
cleanup_prod_names="${cleanup_dir}/prod-secret-names.txt"
cleanup_transcription_names="${cleanup_dir}/transcription-secret-names.txt"
jq -r '[.scopes.common[], .scopes.dev[], .scopes.prod[]] | unique[]' \
  config/environments/policy.json >"${cleanup_dir}/scope-names.txt"
jq -r '[.scopes.common[], .scopes.dev[], .scopes.prod[], .deleteOnlyNames[]] | unique[]' \
  config/environments/policy.json >"${cleanup_blocked_names}"
jq -r '.secretManagerNames[]' config/environments/policy.json \
  | sort -u >"${cleanup_retained_names}"
test "$(wc -l <"${cleanup_dir}/scope-names.txt" | tr -d ' ')" = '25'
test "$(wc -l <"${cleanup_blocked_names}" | tr -d ' ')" = '26'
test "$(wc -l <"${cleanup_retained_names}" | tr -d ' ')" = '37'

awk '/^HETZNER_RUNTIME_SECRETS=\(/,/^\)/' scripts/hetzner/load-secrets.sh \
  | grep -Eo 'INTEXURAOS_[A-Z0-9_]+' | sort -u >"${cleanup_prod_names}"
printf '%s\n' \
  'INTEXURAOS_INTERNAL_AUTH_TOKEN' \
  'INTEXURAOS_SPEECHMATICS_APP_API_KEY' \
  | sort -u >"${cleanup_transcription_names}"
test "$(wc -l <"${cleanup_prod_names}" | tr -d ' ')" = '28'
test "$(wc -l <"${cleanup_transcription_names}" | tr -d ' ')" = '2'
comm -23 "${cleanup_prod_names}" "${cleanup_retained_names}" | grep -q . && exit 1 || true
comm -23 "${cleanup_transcription_names}" "${cleanup_retained_names}" | grep -q . && exit 1 || true
```

At every audit checkpoint, wait at least 15 minutes for log delivery. Build a
server-side exact-name regular expression for the 26 blocked names and require
the result to be empty. `gcloud logging read` has an unlimited default and
exhausts all result pages; do not add `--limit`. Inspect only timestamp,
principal, and resource name, never payloads:

```bash
cleanup_t0="$(<"${cleanup_dir}/T0")"
cleanup_blocked_regex="$(paste -sd'|' "${cleanup_blocked_names}")"

audit_blocked_secret_names() {
  local cleanup_label="$1"
  local cleanup_since="$2"
  local cleanup_output="${cleanup_dir}/${cleanup_label}-blocked-access.tsv"
  local cleanup_filter='logName="projects/intexuraos-dev-pbuchman/logs/cloudaudit.googleapis.com%2Fdata_access"'
  cleanup_filter+=' AND protoPayload.serviceName="secretmanager.googleapis.com"'
  cleanup_filter+=' AND protoPayload.methodName:"AccessSecretVersion"'
  cleanup_filter+=' AND protoPayload.resourceName=~"/secrets/('"${cleanup_blocked_regex}"')/versions/"'
  cleanup_filter+=' AND timestamp>="'"${cleanup_since}"'"'
  CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud logging read \
    "${cleanup_filter}" --project="${cleanup_project}" --order=asc \
    --format='value(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.resourceName)' \
    >"${cleanup_output}"
  test ! -s "${cleanup_output}"
}
```

An empty blocked result is accepted only after a retained-secret positive
control appears in the same logging window. Query it with the same server-side
filter shape and unlimited pagination. Use
`INTEXURAOS_INTERNAL_AUTH_TOKEN` after each production refresh and
`INTEXURAOS_LINEAR_API_KEY` after home-dev sync; the latter is one of the nine
policy secrets intentionally absent from the production 28-name allowlist.
Require at least one entry after the recorded start of the relevant cold start
and verify its principal belongs to that runtime:

```bash
audit_retained_control() {
  local cleanup_label="$1"
  local cleanup_name="$2"
  local cleanup_since="$3"
  local cleanup_expected_principal="$4"
  local cleanup_output="${cleanup_dir}/${cleanup_label}-positive-control.tsv"
  local cleanup_filter='logName="projects/intexuraos-dev-pbuchman/logs/cloudaudit.googleapis.com%2Fdata_access"'
  cleanup_filter+=' AND protoPayload.serviceName="secretmanager.googleapis.com"'
  cleanup_filter+=' AND protoPayload.methodName:"AccessSecretVersion"'
  cleanup_filter+=' AND protoPayload.resourceName=~"/secrets/'"${cleanup_name}"'/versions/"'
  cleanup_filter+=' AND timestamp>="'"${cleanup_since}"'"'
  CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud logging read \
    "${cleanup_filter}" --project="${cleanup_project}" --order=asc \
    --format='value(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.resourceName)' \
    >"${cleanup_output}"
  test -s "${cleanup_output}"
  test "$(cut -f2 "${cleanup_output}" | sort -u)" = "${cleanup_expected_principal}"
}

audit_runtime_secret_set() {
  local cleanup_label="$1"
  local cleanup_since="$2"
  local cleanup_expected_principal="$3"
  local cleanup_expected_names="$4"
  local cleanup_output="${cleanup_dir}/${cleanup_label}-all-access.tsv"
  local cleanup_actual_names="${cleanup_dir}/${cleanup_label}-actual-names.txt"
  local cleanup_filter='logName="projects/intexuraos-dev-pbuchman/logs/cloudaudit.googleapis.com%2Fdata_access"'
  cleanup_filter+=' AND protoPayload.serviceName="secretmanager.googleapis.com"'
  cleanup_filter+=' AND protoPayload.methodName:"AccessSecretVersion"'
  cleanup_filter+=' AND protoPayload.authenticationInfo.principalEmail="'"${cleanup_expected_principal}"'"'
  cleanup_filter+=' AND timestamp>="'"${cleanup_since}"'"'
  CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud logging read \
    "${cleanup_filter}" --project="${cleanup_project}" --order=asc \
    --format='value(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.resourceName)' \
    >"${cleanup_output}"
  test -s "${cleanup_output}"
  test "$(cut -f2 "${cleanup_output}" | sort -u)" = "${cleanup_expected_principal}"
  awk -F'/' '{ for (i = 1; i <= NF; i++) if ($i == "secrets") { print $(i + 1); break } }' \
    "${cleanup_output}" | sort -u >"${cleanup_actual_names}"
  diff -u "${cleanup_expected_names}" "${cleanup_actual_names}"
}

audit_unknown_secret_names() {
  local cleanup_label="$1"
  local cleanup_since="$2"
  local cleanup_output="${cleanup_dir}/${cleanup_label}-all-principals.tsv"
  local cleanup_actual_names="${cleanup_dir}/${cleanup_label}-all-names.txt"
  local cleanup_unknown_names="${cleanup_dir}/${cleanup_label}-unknown-names.txt"
  local cleanup_filter='logName="projects/intexuraos-dev-pbuchman/logs/cloudaudit.googleapis.com%2Fdata_access"'
  cleanup_filter+=' AND protoPayload.serviceName="secretmanager.googleapis.com"'
  cleanup_filter+=' AND protoPayload.methodName:"AccessSecretVersion"'
  cleanup_filter+=' AND timestamp>="'"${cleanup_since}"'"'
  CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud logging read \
    "${cleanup_filter}" --project="${cleanup_project}" --order=asc \
    --format='value(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.resourceName)' \
    >"${cleanup_output}"
  awk -F'/' '{ for (i = 1; i <= NF; i++) if ($i == "secrets") { print $(i + 1); break } }' \
    "${cleanup_output}" | sort -u >"${cleanup_actual_names}"
  comm -23 "${cleanup_actual_names}" "${cleanup_retained_names}" \
    >"${cleanup_unknown_names}"
  test ! -s "${cleanup_unknown_names}"
}
```

Production reads exactly 28 allowlisted secrets per refresh. Home-dev sync reads
all 37 policy-classified secrets. Stop on a blocked read, a missing positive
control, an unexpected principal, or a Secret Manager name outside the 37-name
policy set.

## Execution Order

Do not reorder or combine these steps.

### 1. Merge PR2

Merge the reviewed PR2 to `development` only after full CI and both Terraform
validations pass. Freeze the resulting 40-character merge SHA. Confirm that the
merged policy has 25 tracked config names, 37 Secret Manager names, an empty
`migrationRollbackSecretNames`, and the redirect-only tombstone; both runtime
loaders must block all 26 obsolete names.

Immediately before merging, require the T0 file to exist and record its value in
the operator evidence. If the merge has already happened without T0, stop and
start a new observation window before any deletion.

### 2. Deploy PR2 To Production

Let the push-triggered `Deploy` workflow finish successfully for the frozen
merge SHA. It must perform a complete 28-secret refresh; `--secret` is only a
validation assertion and must never publish a partial environment. Verify the
public and direct-origin `/deployment.json` contain exactly that SHA and a new
canonical `deployedAt`, following the
[Hetzner production runbook](./hetzner-prod-runbook.md).

Wait at least 15 minutes, run the T0 audit query, and require zero reads of the
26 blocked names. Require the production positive control from the same window:

```bash
audit_retained_control \
  'prod-before-apply' \
  'INTEXURAOS_INTERNAL_AUTH_TOKEN' \
  "${cleanup_t0}" \
  "${cleanup_prod_principal}"
audit_runtime_secret_set \
  'prod-before-apply' \
  "${cleanup_t0}" \
  "${cleanup_prod_principal}" \
  "${cleanup_prod_names}"
audit_blocked_secret_names 'prod-before-apply' "${cleanup_t0}"
audit_unknown_secret_names 'prod-before-apply' "${cleanup_t0}"
```

Do not delete anything if either gate fails.

### 3. Apply The Saved Plan

Repeat the plan/checksum/state gates immediately before applying. Apply only
the exact checked file; never run an unqualified `terraform apply`, never add
`-target`, and never regenerate a plan during the procedure:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
  terraform -chdir=terraform/environments/dev apply \
  '/tmp/intexuraos-pr2-targeted-plan.iAIXO3/pr2-targeted.tfplan'
```

Require Terraform to report 0 added, 0 changed, 396 destroyed. Any other result
is a failed run. Preserve the private apply log and post-apply state alongside
the plan, mode `0600`.

Before any restart, verify direct GCP inventory and Terraform state. All 26
blocked names must be absent, all 37 retained policy names must still exist, and
the Secret Manager container names in state must equal the retained set:

```bash
cleanup_gcp_names="${cleanup_dir}/gcp-secret-names-after.txt"
cleanup_state_list="${cleanup_dir}/terraform-state-after.txt"
cleanup_state_secret_names="${cleanup_dir}/terraform-state-secret-names-after.txt"

CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud secrets list \
  --project="${cleanup_project}" --format='value(name.basename())' \
  | sort -u >"${cleanup_gcp_names}"
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
  terraform -chdir=terraform/environments/dev state list \
  >"${cleanup_state_list}"
grep '^module.secret_manager.google_secret_manager_secret.secrets\[' \
  "${cleanup_state_list}" \
  | sed -E 's/^.*\["([^"]+)"\]$/\1/' \
  | sort -u >"${cleanup_state_secret_names}"

while IFS= read -r cleanup_name; do
  ! grep -Fxq "${cleanup_name}" "${cleanup_gcp_names}"
  ! grep -Fq "\"${cleanup_name}\"" "${cleanup_state_list}"
done <"${cleanup_blocked_names}"
while IFS= read -r cleanup_name; do
  grep -Fxq "${cleanup_name}" "${cleanup_gcp_names}"
done <"${cleanup_retained_names}"
diff -u "${cleanup_retained_names}" "${cleanup_state_secret_names}"
```

Next, run only the same targeted address selection as a no-op verification.
The inspected full plan is prohibited because its four unrelated updates make
it `approved=false`. Do not apply this verification plan:

```bash
cleanup_noop_plan="${cleanup_dir}/post-apply-targeted-noop.tfplan"
cleanup_noop_log="${cleanup_dir}/post-apply-targeted-noop.log"
set +e
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
  terraform -chdir=terraform/environments/dev plan -detailed-exitcode \
  -out="${cleanup_noop_plan}" \
  -target=module.secret_manager \
  -target=module.iam \
  -target=google_secret_manager_secret_iam_member.hetzner_provisioner_runtime_secrets \
  -target=google_secret_manager_secret_iam_member.hetzner_runtime_secrets \
  -target=google_secret_manager_secret_version.firebase_api_key \
  -target=google_secret_manager_secret_version.firebase_auth_domain \
  -target=google_secret_manager_secret_version.firebase_project_id \
  -target=google_secret_manager_secret_iam_member.transcription_sentry_dsn_dev \
  >"${cleanup_noop_log}" 2>&1
cleanup_noop_status=$?
set -e
test "${cleanup_noop_status}" = '0'
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
  terraform -chdir=terraform/environments/dev show -json "${cleanup_noop_plan}" \
  | jq -e 'all(.resource_changes[]?; .change.actions == ["no-op"])'
```

This required replan resets T0. Preserve the first window as pre-apply
evidence, then start the final audit window immediately after the no-op plan and
before Step 4. Any later replan resets T0 again and requires repeating the
remaining observation window.

```bash
mv "${cleanup_dir}/T0" "${cleanup_dir}/T0-pre-apply"
cleanup_t0="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf '%s\n' "${cleanup_t0}" >"${cleanup_dir}/T0"
```

### 4. Cold-Sync And Restart home-dev

Wait for the home-dev checkout to contain the frozen merged SHA. From
`$HOME/deploy/intexuraos` on home-dev, refresh the complete dev environment and
cold-restart the process tree. Record `cleanup_home_dev_start` on the operator
machine immediately before starting these commands:

```bash
cleanup_home_dev_start="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
```

On home-dev:

```bash
cd "$HOME/deploy/intexuraos"
test "$(git rev-parse HEAD)" = '<frozen-merge-sha>'
./scripts/sync-secrets.sh --project-id intexuraos-dev-pbuchman
direnv allow
pnpm run services:restart
direnv exec . node scripts/generate-orchestrator-env.mjs \
  --output "$HOME/.code-orchestrator/env"
sudo systemctl restart intexuraos-orchestrator@pbuchman
curl --fail --silent --show-error http://localhost:8199/health | jq .
sudo INTEXURAOS_ENVIRONMENT=dev \
  bash scripts/observability/load-grafana-cloud-env.sh
sudo INTEXURAOS_ENVIRONMENT=dev \
  bash scripts/observability/install-grafana-alloy.sh
sudo systemctl is-active --quiet alloy.service
```

The sync must succeed without a read attempt for any of the 26 deleted names.
Check semantic health for all restarted dev services before continuing. Wait at
least 15 minutes, repeat the exact-26 empty audit, and require the dev-only
retained-secret positive control:

```bash
audit_retained_control \
  'home-dev-after-apply' \
  'INTEXURAOS_LINEAR_API_KEY' \
  "${cleanup_home_dev_start}" \
  "${cleanup_home_dev_principal}"
audit_runtime_secret_set \
  'home-dev-after-apply' \
  "${cleanup_home_dev_start}" \
  "${cleanup_home_dev_principal}" \
  "${cleanup_retained_names}"
audit_blocked_secret_names 'home-dev-after-apply' "${cleanup_home_dev_start}"
audit_unknown_secret_names 'home-dev-after-apply' "${cleanup_home_dev_start}"
```

### 5. Redeploy Production

Manual `workflow_dispatch` has no SHA input. `--ref development` is safe only
while the remote `development` ref points exactly to the frozen merge SHA. Check
the ref immediately before dispatch, then require the created run's `headSha`
to be identical; otherwise cancel/ignore the run and stop:

```bash
cleanup_frozen_sha='<frozen-40-character-merge-sha>'
test "${#cleanup_frozen_sha}" = '40'
cleanup_remote_sha="$(git ls-remote --exit-code origin refs/heads/development | awk '{print $1}')"
test "${cleanup_remote_sha}" = "${cleanup_frozen_sha}"
cleanup_prod2_start="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
gh workflow run deploy.yml --ref development \
  -f target=hetzner-prod -f deploy_nginx=true

# Select the newly-created dispatch after cleanup_prod2_start, then freeze its ID.
cleanup_prod_run_id="$(gh run list --workflow=deploy.yml \
  --event=workflow_dispatch --branch=development --limit=20 \
  --json databaseId,headSha,createdAt \
  | jq -r --arg sha "${cleanup_frozen_sha}" --arg since "${cleanup_prod2_start}" \
    '[.[] | select(.headSha == $sha and .createdAt >= $since)]
     | sort_by(.createdAt) | last | .databaseId // empty')"
test -n "${cleanup_prod_run_id}"
gh run view "${cleanup_prod_run_id}" --json headSha \
  | jq -e --arg sha "${cleanup_frozen_sha}" '.headSha == $sha'
gh run watch "${cleanup_prod_run_id}" --exit-status
```

This second full refresh must fetch all 28 real production secrets after the
containers have been removed. Require semantic health, direct origin, public
health, and both deployment attestations to pass. After at least 15 minutes,
repeat the exact-26 empty audit and require the second production positive
control:

```bash
audit_retained_control \
  'prod-after-apply' \
  'INTEXURAOS_INTERNAL_AUTH_TOKEN' \
  "${cleanup_prod2_start}" \
  "${cleanup_prod_principal}"
audit_runtime_secret_set \
  'prod-after-apply' \
  "${cleanup_prod2_start}" \
  "${cleanup_prod_principal}" \
  "${cleanup_prod_names}"
audit_blocked_secret_names 'prod-after-apply' "${cleanup_prod2_start}"
audit_unknown_secret_names 'prod-after-apply' "${cleanup_prod2_start}"
```

Prove the retained transcription worker can be rebuilt and reach ready state
after deletion. Recheck the remote branch, dispatch the same workflow with
target `transcription`, require its `headSha` to equal the frozen SHA, and wait
for success. The workflow accepts success only when Cloud Build provenance
resolves to its exact `GITHUB_SHA`:

```bash
cleanup_remote_sha="$(git ls-remote --exit-code origin refs/heads/development | awk '{print $1}')"
test "${cleanup_remote_sha}" = "${cleanup_frozen_sha}"
cleanup_transcription_start="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
gh workflow run deploy.yml --ref development -f target=transcription
cleanup_transcription_run_id="$(gh run list --workflow=deploy.yml \
  --event=workflow_dispatch --branch=development --limit=20 \
  --json databaseId,headSha,createdAt \
  | jq -r --arg sha "${cleanup_frozen_sha}" --arg since "${cleanup_transcription_start}" \
    '[.[] | select(.headSha == $sha and .createdAt >= $since)]
     | sort_by(.createdAt) | last | .databaseId // empty')"
test -n "${cleanup_transcription_run_id}"
gh run view "${cleanup_transcription_run_id}" --json headSha \
  | jq -e --arg sha "${cleanup_frozen_sha}" '.headSha == $sha'
gh run watch "${cleanup_transcription_run_id}" --exit-status

cleanup_transcription_state="${cleanup_dir}/transcription-after.json"
CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud functions describe \
  intexuraos-transcription-dev --gen2 --region=europe-central2 \
  --project="${cleanup_project}" --format=json \
  >"${cleanup_transcription_state}"
jq -e --arg principal "${cleanup_transcription_principal}" '
  .state == "ACTIVE" and
  .serviceConfig.serviceAccountEmail == $principal and
  (.serviceConfig.uri | length > 0) and
  (.serviceConfig.revision | length > 0)
' "${cleanup_transcription_state}"

cleanup_transcription_uri="$(jq -r '.serviceConfig.uri' "${cleanup_transcription_state}")"
cleanup_transcription_revision="$(jq -r '.serviceConfig.revision' "${cleanup_transcription_state}")"
cleanup_transcription_token="$(
  CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud auth print-identity-token \
    --impersonate-service-account="${cleanup_transcription_principal}" \
    --audiences="${cleanup_transcription_uri}"
)"
cleanup_transcription_status="$(curl --silent --show-error --output /dev/null \
  --write-out '%{http_code}' \
  --header "Authorization: Bearer ${cleanup_transcription_token}" \
  "${cleanup_transcription_uri%/}/__cold_start_probe__")"
unset cleanup_transcription_token
test "${cleanup_transcription_status}" = '404'

cleanup_transcription_request_log="${cleanup_dir}/transcription-cold-start-request.tsv"
cleanup_transcription_filter='resource.type="cloud_run_revision"'
cleanup_transcription_filter+=' AND resource.labels.service_name="intexuraos-transcription-dev"'
cleanup_transcription_filter+=' AND httpRequest.requestUrl:"/__cold_start_probe__"'
cleanup_transcription_filter+=' AND httpRequest.requestMethod="GET"'
cleanup_transcription_filter+=' AND httpRequest.status=404'
cleanup_transcription_filter+=' AND timestamp>="'"${cleanup_transcription_start}"'"'
for cleanup_attempt in $(seq 1 30); do
  CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${cleanup_sa_key}" gcloud logging read \
    "${cleanup_transcription_filter}" --project="${cleanup_project}" --order=asc \
    --format='value(timestamp,resource.labels.revision_name,httpRequest.status,httpRequest.requestMethod)' \
    >"${cleanup_transcription_request_log}"
  test -s "${cleanup_transcription_request_log}" && break
  sleep 10
done
test -s "${cleanup_transcription_request_log}"
test "$(cut -f2 "${cleanup_transcription_request_log}" | sort -u)" = \
  "${cleanup_transcription_revision}"
test "$(cut -f3 "${cleanup_transcription_request_log}" | sort -u)" = '404'
test "$(cut -f4 "${cleanup_transcription_request_log}" | sort -u)" = 'GET'
```

The authenticated `GET /__cold_start_probe__` is deliberately routed to an
unregistered path. The expected 404 starts the exact deployed container and
loads its secret environment without publishing a Pub/Sub event or starting a
transcription. Keep both workflow URLs, their exact `headSha`, the transcription
Cloud Build provenance check, the `ACTIVE` description, and the matching Cloud
Run request-log row as cold-start evidence.

### 6. Verify Health And Audit

Run the complete production health procedure in the
[Hetzner production runbook](./hetzner-prod-runbook.md), including the PM2
readiness gate, nginx validation, direct-origin and public WhatsApp semantic
health, and exact `/deployment.json` SHA verification.

Wait at least 15 minutes after the last cold start, repeat the T0 Data Access
query, then execute the transcription gates:

```bash
audit_retained_control \
  'transcription-after-apply' \
  'INTEXURAOS_INTERNAL_AUTH_TOKEN' \
  "${cleanup_transcription_start}" \
  "${cleanup_transcription_principal}"
audit_runtime_secret_set \
  'transcription-after-apply' \
  "${cleanup_transcription_start}" \
  "${cleanup_transcription_principal}" \
  "${cleanup_transcription_names}"
audit_blocked_secret_names 'transcription-after-apply' "${cleanup_t0}"
audit_unknown_secret_names 'transcription-after-apply' "${cleanup_t0}"
```

Require:

- 26 blocked names: zero `AccessSecretVersion` reads since T0;
- pre-apply T0 evidence: the first production refresh read its exact 28-name
  allowlist and no blocked name;
- current T0 evidence after the required replan: home-dev read the 37-name
  policy set, the second production refresh read its exact 28-name subset, and
  any retained transcription reads are tied to its frozen-SHA redeploy;
- names outside the policy: zero reads;
- every active runtime healthy with the frozen merged SHA.

Only then close the cleanup. Retain the private checksum, summary, state,
workflow URLs, deployment attestations, health result, and name-only audit
evidence in the operator evidence location; do not commit them.

## Rollback Boundary

The oldest safe application rollback is
`f9e4d21910a553405ea0b278fb59bc696c8ebe65`. Roll back only to this commit or a
newer reviewed commit, using the normal production deployment and home-dev
sync/restart paths. This floor already reads the migrated values from versioned
configuration and blocks the retired names.

**Older commits and old Terraform are prohibited.** They may try to read the
deleted names or restore the obsolete resource model. Reapply only the current
PR2 Terraform after an application rollback.

**Recreating empty Secret Manager containers is not rollback.** It does not
restore versions or values, and it reintroduces the billing and ambiguity this
cleanup removes. If health fails, keep the deleted names deleted, deploy the
rollback floor or newer code, repeat the complete runtime sync, and re-run the
health and Data Access gates.
