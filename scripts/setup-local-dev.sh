#!/usr/bin/env bash
# Safe local gittr dev setup — never overwrites GitHub/server code with stale backup.
#
# Usage:
#   ./scripts/setup-local-dev.sh [BACKUP_DIR]
#
# BACKUP_DIR defaults to ~/Downloads/actual/ngit (old laptop backup).
# Creates/refreshes ~/Projects/gittr from GitHub main and merges LOCAL-ONLY files only.

set -euo pipefail

BACKUP_DIR="${1:-$HOME/Downloads/actual/ngit}"
TARGET="$HOME/Projects/gittr"
REPO_URL="git@github.com:arbadacarbaYK/gittr.git"
PRESERVE_DIR="$TARGET/_local-only-backup"

echo "=== gittr local dev setup ==="
echo "Target:  $TARGET"
echo "Backup:  $BACKUP_DIR (local-only files only)"
echo ""

# --- Node.js ---
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js (apt)..."
  sudo apt-get update -qq
  sudo apt-get install -y nodejs npm
fi
echo "Node $(node --version) / npm $(npm --version)"

# --- Fresh clone or update from GitHub (source of truth for CODE) ---
if [ ! -d "$TARGET/.git" ]; then
  echo "Cloning from GitHub main..."
  git clone --branch main "$REPO_URL" "$TARGET"
else
  echo "Updating existing clone from origin/main..."
  git -C "$TARGET" fetch origin
  git -C "$TARGET" checkout main
  git -C "$TARGET" pull --ff-only origin main || {
    echo "ERROR: local main has commits — stash or branch before pull."
    exit 1
  }
fi

# --- Preserve local-only files from backup (never copy ui/src from backup!) ---
mkdir -p "$PRESERVE_DIR"
LOCAL_ONLY=(
  "upload_to_hetzner.sh"
  ".env"
  ".env.example"
  "ui/.env.local"
  "ui/.env.example"
)

echo ""
echo "Preserving local-only files from backup..."
for rel in "${LOCAL_ONLY[@]}"; do
  src="$BACKUP_DIR/$rel"
  if [ -f "$src" ]; then
    mkdir -p "$PRESERVE_DIR/$(dirname "$rel")"
    cp -a "$src" "$PRESERVE_DIR/$rel"
    mkdir -p "$TARGET/$(dirname "$rel")"
    cp -a "$src" "$TARGET/$rel"
    echo "  ✓ $rel"
  else
    echo "  - skip (not in backup): $rel"
  fi
done

# --- Install & build ---
echo ""
echo "Installing UI dependencies..."
cd "$TARGET/ui"
npm install

echo ""
echo "Building UI (verifies TypeScript)..."
npm run build

echo ""
echo "=== Done ==="
echo "Work here:  cd $TARGET/ui && npm run dev"
echo "Deploy:     cd $TARGET && ./upload_to_hetzner.sh <host>"
echo ""
echo "NEVER rsync or upload from $BACKUP_DIR — it may contain stale code."
echo "Code truth: GitHub main + your commits in $TARGET"
