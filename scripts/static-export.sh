#!/usr/bin/env bash
# Build a static export of the pre-baked demo for Butterbase (nextjs-static).
# API route handlers can't coexist with output:"export", so we move them aside,
# build, then restore.
set -e
cd "$(dirname "$0")/.."

API_DIR="src/app/api"
API_BAK="/tmp/dito_api_backup_$$"

restore() {
  if [ -d "$API_BAK" ]; then
    rm -rf "$API_DIR"
    mv "$API_BAK" "$API_DIR"
    echo "restored $API_DIR"
  fi
}
trap restore EXIT

echo "== moving API routes aside =="
mv "$API_DIR" "$API_BAK"

echo "== building static export =="
rm -rf out .next
STATIC_EXPORT=1 npx next build

echo "== done: out/ =="
ls out | head
du -sh out
