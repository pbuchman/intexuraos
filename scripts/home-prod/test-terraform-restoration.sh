#!/usr/bin/env bash
set -euo pipefail

# Terraform >=1.7 supplies mock providers. The production root still supports
# Terraform 1.5 for ordinary fmt/validate/plan/apply.
readonly SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../terraform/prod-runtime" && pwd)"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-restoration-terraform.XXXXXX")"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
mkdir -p "${TEST_ROOT}/tests"
for source in "${SOURCE_ROOT}"/*.tf; do
  # Recovery imports cannot be mocked by Terraform: they refer to persistent
  # state, which this local fixture must never import or read. Their exact
  # identities remain checked by prod-runtime-terraform.test.ts.
  [[ "${source##*/}" == 'imports.tf' ]] && continue
  cp "${source}" "${TEST_ROOT}/"
done
cp "${SOURCE_ROOT}/prod.auto.tfvars.json" "${TEST_ROOT}/"
cp "${SOURCE_ROOT}/.terraform.lock.hcl" "${TEST_ROOT}/"
cp "${SOURCE_ROOT}/tests/restoration.tftest.hcl" "${TEST_ROOT}/tests/"
export STORAGE_EMULATOR_HOST='' FIRESTORE_EMULATOR_HOST='' PUBSUB_EMULATOR_HOST=''
export TF_DATA_DIR="${TEST_ROOT}/.terraform"
terraform -chdir="${TEST_ROOT}" init -backend=false -input=false -no-color >/dev/null
terraform -chdir="${TEST_ROOT}" test -no-color
