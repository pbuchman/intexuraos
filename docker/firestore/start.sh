#!/bin/sh
set -eu

# Message Digest alone uses this project. Snapshot directories are immutable;
# the current symlink advances only after the emulator confirms a complete export.
project=intexuraos-message-digest-mvp-local
set -- start --host=0.0.0.0 --port=8101 --database-mode=firestore-native
if [ -e /data/current ] || [ -L /data/current ]; then
  if [ ! -s /data/current/firestore.overall_export_metadata ]; then
    echo 'Existing Firestore snapshot is incomplete; refusing to start empty.' >&2
    exit 1
  fi
  set -- "$@" --seed_from_export=/data/current/firestore.overall_export_metadata
fi

java -Duser.language=en -cp /google-cloud-sdk/platform/cloud-firestore-emulator/cloud-firestore-emulator.jar com.google.cloud.datastore.emulator.firestore.CloudFirestore "$@" &
emulator_pid=$!

shutdown() {
  trap '' TERM INT
  snapshot=$(mktemp -d /data/snapshot.XXXXXX)
  if curl --fail --silent --show-error --max-time 45 \
    -H 'Content-Type: application/json' \
    -d "{\"database\":\"projects/${project}/databases/(default)\",\"export_directory\":\"${snapshot}\",\"export_name\":\"firestore\"}" \
    "http://127.0.0.1:8101/emulator/v1/projects/${project}:export"; then
    ln -s "${snapshot}/firestore" "${snapshot}/current-link"
    mv -Tf "${snapshot}/current-link" /data/current
  else
    echo 'Firestore snapshot export failed; previous snapshot remains intact.' >&2
    kill -TERM "${emulator_pid}"
    wait "${emulator_pid}" || true
    exit 1
  fi
  kill -TERM "${emulator_pid}"
  wait "${emulator_pid}" || true
  exit 0
}
trap shutdown TERM INT
wait "${emulator_pid}"
