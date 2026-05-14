#!/usr/bin/env bash
# Deploy infra/nsite-gateway (+ gittr-nsite-gateway overlay) to a host over SSH.
# Requires: Docker Engine + Compose v2 plugin on the server (see SETUP_INSTRUCTIONS.md).
#
# Usage (from repo root):
#   export SSH_KEY=~/.ssh/id_ed25519   # optional; defaults below
#   ./scripts/deploy-nsite-gateway.sh your.server.example
#   # or: DEPLOY_HOST=your.server.example ./scripts/deploy-nsite-gateway.sh

set -euo pipefail

HOST="${1:-${DEPLOY_HOST:-}}"
if [[ -z "${HOST}" ]]; then
  echo "❌ Missing host. Usage: $0 <ssh-hostname-or-ip>"
  echo "   Example: $0 my.gateway.internal"
  echo "   Or set DEPLOY_HOST and run with no args."
  exit 1
fi

KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
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

echo "📦 Syncing gittr nsite-gateway fork (for /status/manifests.json build)…"
ssh -i "$KEY" -o BatchMode=yes "root@${HOST}" "rm -rf '/opt/ngit/infra/gittr-nsite-gateway'"
scp -i "$KEY" -q -r "$ROOT/infra/gittr-nsite-gateway" "root@${HOST}:/opt/ngit/infra/"

scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/docker-compose.yml" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/docker-compose.gittr-gateway.yml" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/README.md" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/.env.example" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/gittr-pages.production.env" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/nginx-pages.gittr.space.conf.example" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT/infra/nsite-gateway/expand-wildcard-cert.sh" "root@${HOST}:${REMOTE}/"
scp -i "$KEY" -q "$ROOT"/infra/nsite-gateway/public/* "root@${HOST}:${REMOTE}/public/"
ssh -i "$KEY" -o BatchMode=yes "root@${HOST}" "chmod +x '${REMOTE}/expand-wildcard-cert.sh' 2>/dev/null || true"

echo "🔧 Installing Docker if missing (Debian/Ubuntu, non-interactive)..."
ssh -i "$KEY" -o BatchMode=yes "root@${HOST}" 'export DEBIAN_FRONTEND=noninteractive
  if command -v docker >/dev/null 2>&1; then echo "Docker already installed"; exit 0; fi
  apt-get update -qq
  # Ubuntu 24.04+ uses docker-compose-v2 (provides `docker compose`); older releases use docker-compose-plugin
  apt-get install -y -qq docker.io docker-compose-v2 || apt-get install -y -qq docker.io docker-compose-plugin
  systemctl enable --now docker
  docker --version
'

echo "🔧 Writing production .env on server (from gittr-pages.production.env)..."
ssh -i "$KEY" -o BatchMode=yes "root@${HOST}" "install -m 0600 -T '${REMOTE}/gittr-pages.production.env' '${REMOTE}/.env'"

echo "🐳 Building gittr gateway fork image and restarting stack…"
ssh -i "$KEY" -o BatchMode=yes "root@${HOST}" "cd '${REMOTE}' && docker compose -f docker-compose.yml -f docker-compose.gittr-gateway.yml build && docker compose -f docker-compose.yml -f docker-compose.gittr-gateway.yml up -d"

echo "✅ nsite gateway should be listening on host port 3040 (see SETUP_INSTRUCTIONS.md for HTTPS / reverse-proxy in front)."
