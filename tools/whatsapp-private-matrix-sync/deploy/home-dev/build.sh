#!/usr/bin/env bash
set -euo pipefail
source_sha="${1:?usage: build.sh EXACT_REVIEWED_SOURCE_SHA}"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'exact_source_sha_required' >&2; exit 1; }
tool_dir="$(cd "$(dirname "$0")/../.." && pwd)"
[[ "$(git -C "$tool_dir" rev-parse HEAD)" == "$source_sha" ]] || { echo 'source_revision_mismatch' >&2; exit 1; }
[[ -z "$(git -C "$tool_dir" status --porcelain -- .)" ]] || { echo 'canonical_tool_source_not_committed' >&2; exit 1; }
docker build --build-arg "SOURCE_SHA=$source_sha" --build-arg FIXTURE_BUILD=false --tag "intexuraos-matrix-sync:$source_sha" "$tool_dir"
