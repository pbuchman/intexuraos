#!/usr/bin/env bash
#
# Sync Firestore data from GCP to local emulator.
#
# Usage:
#   ./scripts/sync-firestore.sh                    # Full export
#   ./scripts/sync-firestore.sh users prompts      # Specific collections
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - PROJECT_ID environment variable set
#   - GCS bucket for exports exists
#

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
BUCKET="${FIRESTORE_EXPORT_BUCKET:-${PROJECT_ID}-firestore-exports}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
EXPORT_DIR="${ROOT_DIR}/data/firestore-export"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

COLLECTIONS=("$@")
BUCKET_LOCATION="${BUCKET_LOCATION:-EU}"

echo "=== Firestore Sync ==="
echo "Project: ${PROJECT_ID}"
echo "Bucket: gs://${BUCKET}"
if [ ${#COLLECTIONS[@]} -eq 0 ]; then
  echo "Collections: ALL"
else
  echo "Collections: ${COLLECTIONS[*]}"
fi
echo ""

if ! command -v gcloud &> /dev/null; then
  echo "ERROR: gcloud CLI not found. Install Google Cloud SDK first."
  exit 1
fi

if ! command -v gsutil &> /dev/null; then
  echo "ERROR: gsutil not found. Install Google Cloud SDK first."
  exit 1
fi

if ! gsutil ls -b "gs://${BUCKET}" &> /dev/null; then
  echo "Bucket gs://${BUCKET} not found. Creating in ${BUCKET_LOCATION}..."
  gsutil mb -l "${BUCKET_LOCATION}" "gs://${BUCKET}"
fi

echo "[1/3] Exporting from GCP Firestore..."
EXPORT_PATH="gs://${BUCKET}/export-${TIMESTAMP}"

if [ ${#COLLECTIONS[@]} -eq 0 ]; then
  gcloud firestore export "${EXPORT_PATH}" \
    --project="${PROJECT_ID}"
else
  COLLECTION_IDS=$(IFS=,; echo "${COLLECTIONS[*]}")
  gcloud firestore export "${EXPORT_PATH}" \
    --collection-ids="${COLLECTION_IDS}" \
    --project="${PROJECT_ID}"
fi

echo ""
echo "[2/3] Downloading to local..."
rm -rf "${EXPORT_DIR}"
mkdir -p "${EXPORT_DIR}"
gsutil -m cp -r "${EXPORT_PATH}/*" "${EXPORT_DIR}/"

echo ""
echo "[3/3] Restarting emulators with imported data..."
cd "${ROOT_DIR}"
docker compose -f docker/docker-compose.local.yaml down || true
docker compose -f docker/docker-compose.local.yaml up -d --build

echo ""
echo "Waiting for all emulators to be ready..."
SERVICES=("Firestore:8100" "Firestore-API:8101" "Pub/Sub:8102" "GCS:8103" "Firebase-Auth:8104" "Pub/Sub-UI:8105")
for service in "${SERVICES[@]}"; do
  NAME="${service%%:*}"
  PORT="${service##*:}"
  for i in {1..60}; do
    if curl -sf "http://localhost:${PORT}" > /dev/null 2>&1 || \
       curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
      echo "  ${NAME} ready on port ${PORT}"
      break
    fi
    if [ $i -eq 60 ]; then
      echo "ERROR: ${NAME} failed to start on port ${PORT}"
      exit 1
    fi
    sleep 1
  done
done

echo ""
echo "=== Sync Complete ==="
echo "Firestore UI:  http://localhost:8100"
echo "Pub/Sub UI:    http://localhost:8105"
echo "Data imported from: ${EXPORT_PATH}"
