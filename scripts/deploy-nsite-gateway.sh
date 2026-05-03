#!/usr/bin/env bash
# Deploy infra/nsite-gateway to Hetzner (or any host) over SSH.
# Requires: Docker Engine + Compose v2 plugin on the server (see SETUP_INSTRUCTIONS.md).
#
# Usage (from repo root):
#   ./scripts/deploy-nsite-gateway.sh
#   ./scripts/deploy-nsite-gateway.sh 91.99.86.115
#
# SSH key defaults to ~/.ssh/id_ed25519_hetzner_new (same as upload_to_hetzner.sh).

set -euo pipefail

HOST="${1:-91.99.86.115}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner_new}"
REMOTE="/opt/ngit/infra/nsite-gateway"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$KEY" ]]; then
  echo "❌ SSH key not found: $KEY"
  echo "   Set SSH_KEY=/path/to/key or create the default key."
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1 || ! command -v scp >/dev/null 2>&1; then
  echo "❌ ssh and scp are required."
  exit 1
fi

echo "📦 Deploying nsite gateway → root@${HOST}:${REMOTE}"
ssh -i "$KEY" -o BatchMode=yes "root@${HOST}" "mkdir -p '${REMOTE}/public'"

scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/docker-compose.yml" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/README.md" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/.env.example" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/nginx-pages.gittr.space.conf.example" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/public/index.html" "root@${HOST}:${REMOTE}/public/"

echo "🔧 Ensuring .env on server (never overwrites existing .env)..."
ssh -i "$KEY" "root@${HOST}" "cd '${REMOTE}' && (test -f .env || cp .env.example .env)"

echo "🐳 Pulling image and restarting stack (requires Docker on server)..."
ssh -i "$KEY" "root@${HOST}" "command -v docker >/dev/null 2>&1" || {
  echo "❌ Docker not found on server. On Debian/Ubuntu:"
  echo "   sudo apt update && sudo apt install -y docker.io docker-compose-plugin"
  echo "   sudo systemctl enable --now docker"
  exit 1
}

ssh -i "$KEY" "root@${HOST}" "cd '${REMOTE}' && docker compose pull && docker compose up -d"

echo "✅ nsite gateway should be listening on host port 3040 (proxy https://pages.gittr.space → 127.0.0.1:3040 per SETUP_INSTRUCTIONS.md)."
