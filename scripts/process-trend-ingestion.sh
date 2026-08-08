#!/bin/bash
# Triggers the Trend Radar ingestion job. Runs every 2-6h via cron on the VPS
# — see OPERATIONS.md for the crontab entry.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/clipforge/.env}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

curl -sS -X POST "$NEXTAUTH_URL/api/trend/ingest" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json"
echo
