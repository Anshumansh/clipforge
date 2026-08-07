#!/bin/bash
# Dumps the production Postgres database and uploads it to the same B2 bucket
# used for media, under backups/. Also prunes backups older than RETENTION_DAYS
# — B2's S3-compatible API rejected a standard bucket lifecycle rule (MalformedXML
# on both variants tried), so retention is handled here instead.
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-30}"

ENV_FILE="${ENV_FILE:-/opt/clipforge/.env}"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="/tmp/clipforge-db-$TIMESTAMP.sql.gz"

cleanup() { rm -f "$FILE"; }
trap cleanup EXIT

docker run --rm -e DATABASE_URL="$DATABASE_URL" postgres:17-alpine \
  sh -c 'pg_dump "$DATABASE_URL"' | gzip > "$FILE"

export AWS_ACCESS_KEY_ID="$STORAGE_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$STORAGE_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$STORAGE_REGION"

aws --endpoint-url "$STORAGE_ENDPOINT" s3 cp "$FILE" \
  "s3://$STORAGE_BUCKET/backups/db-$TIMESTAMP.sql.gz" --only-show-errors

echo "Backed up to s3://$STORAGE_BUCKET/backups/db-$TIMESTAMP.sql.gz"

CUTOFF=$(date -u -d "-$RETENTION_DAYS days" +%Y%m%d)
aws --endpoint-url "$STORAGE_ENDPOINT" s3 ls "s3://$STORAGE_BUCKET/backups/" | while read -r _ _ _ name; do
  [[ "$name" =~ ^db-([0-9]{8})- ]] || continue
  file_date="${BASH_REMATCH[1]}"
  if [[ "$file_date" < "$CUTOFF" ]]; then
    aws --endpoint-url "$STORAGE_ENDPOINT" s3 rm "s3://$STORAGE_BUCKET/backups/$name" --only-show-errors
    echo "Pruned old backup: $name"
  fi
done
