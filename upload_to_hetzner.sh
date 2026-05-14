#!/bin/bash
# Upload changed files to Hetzner server
# Usage: ./upload_to_hetzner.sh <hostname_or_ip>
#
# ⚠️  CRITICAL: TEST ALL PAGES LOCALLY BEFORE DEPLOYING!
#   1. Build locally: cd ui && npm run build
#   2. Test in browser: npm run dev (check all pages work)
#   3. Check console for errors on: /, /repositories, /explore, /zaps, /[entity], /[entity]/[repo]
#   4. Verify no hydration errors, no "Rendered more hooks" errors
#   5. Only deploy when ALL pages work correctly!
#
# ⚠️  Server build MUST finish: new themes and CSS only appear after "yarn build" completes
#     on the server. If the script times out, SSH in and run:
#     cd /opt/gittr/ui && yarn build && sudo systemctl restart gittr-frontend
#
# Note: Frontend files go to $FRONTEND_PATH/ui (used by gittr-frontend service)
#       Bridge source files go to $FRONTEND_PATH/ui/gitnostr (same path as frontend)
#       Bridge binary is built at $FRONTEND_PATH/ui/gitnostr/bin/git-nostr-bridge
#       Bridge runs as git-nostr user via systemd service
#
# Deploy root defaults to /opt/gittr. Override if needed:
#   FRONTEND_PATH=/other/path ./upload_to_hetzner.sh 91.99.86.115
#
# IMPORTANT: Bridge source code is in THIS repo (ui/gitnostr/), NOT fetched from GitHub!
#            The go.mod declares "module github.com/arbadacarbaYK/gitnostr" but that's just
#            the Go module path identifier - all actual source is local and gets uploaded.

# ⚠️  CRITICAL: Check for unsaved changes before uploading!
echo "🔍 Checking for unsaved changes..."
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ ERROR: You have unsaved changes in your working directory!"
    echo ""
    echo "Please save all files in your editor before uploading."
    echo "Files with changes:"
    git diff --name-only
    git diff --cached --name-only
    echo ""
    echo "After saving, run this script again."
    exit 1
fi
echo "✅ All changes are saved (git working directory is clean)"
echo ""

HOST=${1:-"91.99.86.115"}
KEY=~/.ssh/id_ed25519_hetzner_new
FRONTEND_PATH="${FRONTEND_PATH:-/opt/gittr}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Note: Bridge now uses same path as frontend ($FRONTEND_PATH)

if [ "$HOST" = "YOUR_HETZNER_HOSTNAME_OR_IP" ]; then
    echo "Usage: $0 <hostname_or_ip>"
    echo "Example: $0 91.99.86.115"
    exit 1
fi

# Speed toggles (export before running). Safe defaults skip redundant work.
# SKIP_REDUNDANT_SCP=0  → also run legacy per-file scp list after bulk ui/src (rarely needed)
# SKIP_GATEWAY_DEPLOY=0 → run Docker nsite-gateway deploy at end
# SKIP_BRIDGE_ALL=1     → skip gitnostr upload + bridge rebuild (UI-only deploys)
# SKIP_YARN_INSTALL=1   → skip yarn install on server (faster; only safe if deps unchanged)
# SKIP_SSHD_GIT_KEYS_FIX=1 → skip sshd Match User git fix (see scripts/ensure-sshd-git-live-authorized-keys.sh)
SKIP_REDUNDANT_SCP="${SKIP_REDUNDANT_SCP:-1}"
SKIP_GATEWAY_DEPLOY="${SKIP_GATEWAY_DEPLOY:-1}"
SKIP_BRIDGE_ALL="${SKIP_BRIDGE_ALL:-0}"
SKIP_YARN_INSTALL="${SKIP_YARN_INSTALL:-0}"
SKIP_SSHD_GIT_KEYS_FIX="${SKIP_SSHD_GIT_KEYS_FIX:-0}"

echo "📤 Uploading files to $HOST..."
echo "   Frontend & Bridge: $FRONTEND_PATH/ui"
echo ""

# Bridge / file-open fixes: file-content.ts, clone.ts, [repo]/page.tsx are uploaded below
# (explicit scp lines + full ui/src sync). Optional: nostr-pushed-repos.txt is gitignored
# (npub/repo paths for sitemap); maintain a copy locally or on CI secrets, not in GitHub.
if [ -f nostr-pushed-repos.txt ]; then
  echo "📇 Uploading nostr-pushed-repos.txt (sitemap / SEO; file not committed to git)..."
  scp -i $KEY nostr-pushed-repos.txt root@$HOST:$FRONTEND_PATH/nostr-pushed-repos.txt
else
  echo "⚠️  nostr-pushed-repos.txt not at repo root — sitemap will use static pages only"
fi
echo ""

# Frontend files (go to $FRONTEND_PATH/ui)
echo "📦 Uploading frontend files..."
echo "📦 Syncing entire ui/src (covers formatting + broad changes)..."
scp -i $KEY -r ui/src/* root@$HOST:$FRONTEND_PATH/ui/src/
if [ "$SKIP_REDUNDANT_SCP" != "1" ]; then
  echo "📎 Legacy per-file scp (SKIP_REDUNDANT_SCP!=1)…"
scp -i $KEY ui/src/app/repositories/repos-list.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/repositories/repos-list.tsx
scp -i $KEY ui/src/app/repositories/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/repositories/page.tsx
scp -i $KEY ui/src/app/repositories/find-corrupted-repos.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/repositories/find-corrupted-repos.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/sitemap.ts root@$HOST:$FRONTEND_PATH/ui/src/app/sitemap.ts
scp -i $KEY ui/src/app/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/page.tsx
scp -i $KEY ui/src/app/[entity]/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/page.tsx
scp -i $KEY ui/src/app/[entity]/layout.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/layout.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/layout.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/layout.tsx
scp -i $KEY ui/src/styles/globals.css root@$HOST:$FRONTEND_PATH/ui/src/styles/globals.css
scp -i $KEY ui/src/app/[entity]/[repo]/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/layout.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/layout.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/[entity]/[repo]/layout-client.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/layout-client.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/[entity]/[repo]/dependencies/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/dependencies/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/architecture/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/architecture/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/issues/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/issues/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/issues/[id]/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/issues/\[id\]/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/pulls/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/pulls/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/pulls/[id]/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/pulls/\[id\]/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/pulls/new/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/pulls/new/page.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/[entity]/[repo]/discussions/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/discussions/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/discussions/new/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/discussions/new/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/discussions/[id]/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/discussions/\[id\]/page.tsx
scp -i $KEY ui/src/app/[entity]/[repo]/commits/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/commits/page.tsx
scp -i $KEY ui/src/app/issues/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/issues/page.tsx
scp -i $KEY ui/src/app/pulls/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/pulls/page.tsx
scp -i $KEY ui/src/app/help/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/help/page.tsx
scp -i $KEY ui/src/app/new/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/new/page.tsx
scp -i $KEY ui/src/app/explore/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/explore/page.tsx
scp -i $KEY ui/src/app/zaps/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/zaps/page.tsx
scp -i $KEY ui/src/components/logo.tsx root@$HOST:$FRONTEND_PATH/ui/src/components/logo.tsx
scp -i $KEY ui/src/components/ui/header.tsx root@$HOST:$FRONTEND_PATH/ui/src/components/ui/header.tsx
scp -i $KEY ui/src/components/mobile-nav.tsx root@$HOST:$FRONTEND_PATH/ui/src/components/mobile-nav.tsx 2>/dev/null || true
scp -i $KEY ui/src/components/ui/code-viewer.tsx root@$HOST:$FRONTEND_PATH/ui/src/components/ui/code-viewer.tsx
scp -i $KEY ui/src/components/ui/copyable-code-block.tsx root@$HOST:$FRONTEND_PATH/ui/src/components/ui/copyable-code-block.tsx
scp -i $KEY ui/src/components/ui/tooltip.tsx root@$HOST:$FRONTEND_PATH/ui/src/components/ui/tooltip.tsx
scp -i $KEY ui/src/components/ui/repo-qr-share.tsx root@$HOST:$FRONTEND_PATH/ui/src/components/ui/repo-qr-share.tsx 2>/dev/null || true
scp -i $KEY ui/src/components/ui/bolt-snow.tsx root@$HOST:$FRONTEND_PATH/ui/src/components/ui/bolt-snow.tsx
scp -i $KEY ui/src/lib/nostr/useContributorMetadata.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/useContributorMetadata.ts
scp -i $KEY ui/src/app/login/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/login/page.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/[entity]/[repo]/layout.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/layout.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/[entity]/[repo]/layout-client.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/layout-client.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/[entity]/[repo]/settings/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/settings/page.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/settings/account/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/settings/account/page.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/settings/layout.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/settings/layout.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/settings/relays/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/settings/relays/page.tsx 2>/dev/null || true
scp -i $KEY ui/src/app/settings/ssh-keys/page.tsx root@$HOST:$FRONTEND_PATH/ui/src/app/settings/ssh-keys/page.tsx 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/NostrContext.tsx root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/NostrContext.tsx 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/events.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/events.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/getAllRelays.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/getAllRelays.ts
scp -i $KEY ui/src/lib/nostr/localStorage.tsx root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/localStorage.tsx 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/remoteSigner.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/remoteSigner.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/repo-stars.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/repo-stars.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/push-repo-to-nostr.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/push-repo-to-nostr.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/push-to-bridge.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/push-to-bridge.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/bridge-auth.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/bridge-auth.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/publish-with-confirmation.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/publish-with-confirmation.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/api/cors.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/api/cors.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/events.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/events.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/utils/grasp-servers.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/utils/grasp-servers.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/utils/grasp-list.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/utils/grasp-list.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/utils/git-source-fetcher.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/utils/git-source-fetcher.ts
scp -i $KEY ui/src/lib/utils/repo-status.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/utils/repo-status.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/utils/repo-finder.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/utils/repo-finder.ts
scp -i $KEY ui/src/lib/utils/entity-resolver.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/utils/entity-resolver.ts
scp -i $KEY ui/src/lib/repos/storage.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/repos/storage.ts
scp -i $KEY ui/src/lib/utils/metadata-icon-resolver.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/utils/metadata-icon-resolver.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/utils/repo-corruption-check.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/utils/repo-corruption-check.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/repo-permissions.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/repo-permissions.ts
scp -i $KEY ui/src/lib/activity-tracking.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/activity-tracking.ts
scp -i $KEY ui/src/lib/stats.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/stats.ts
scp -i $KEY ui/src/lib/nostr/delete-corrupted-events.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/delete-corrupted-events.ts 2>/dev/null || true
scp -i $KEY ui/src/lib/nostr/find-corrupted-event-publisher.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/nostr/find-corrupted-event-publisher.ts 2>/dev/null || true
scp -i $KEY ui/src/app/[entity]/[repo]/metadata.ts root@$HOST:$FRONTEND_PATH/ui/src/app/\[entity\]/\[repo\]/metadata.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/nostr/repo/push.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/push.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/nostr/repo/push-auth.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/push-auth.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/nostr/repo/push-challenge.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/push-challenge.ts
scp -i $KEY ui/src/app/api/middleware/rate-limit.ts root@$HOST:$FRONTEND_PATH/ui/src/app/api/middleware/rate-limit.ts
scp -i $KEY ui/src/pages/api/nostr/repo/refs.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/refs.ts
scp -i $KEY ui/src/pages/api/nostr/repo/commits.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/commits.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/nostr/repo/files.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/files.ts
scp -i $KEY ui/src/pages/api/nostr/repo/file-content.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/file-content.ts
scp -i $KEY ui/src/pages/api/git/file-content.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/git/file-content.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/nostr/repo/exists.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/exists.ts
scp -i $KEY ui/src/pages/api/nostr/repo/clone.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/clone.ts
scp -i $KEY ui/src/pages/api/nostr/repo/event.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/repo/event.ts 2>/dev/null || echo "  ⚠️  Note: event.ts may need to be created on server"
scp -i $KEY ui/src/pages/api/git/nip05-resolve.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/git/nip05-resolve.ts
scp -i $KEY ui/src/pages/api/nostr/info.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/nostr/info.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/balance/lnbits.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/balance/lnbits.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/zap/lnbits.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/zap/lnbits.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/zap/nwc.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/zap/nwc.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/bounty/create-withdraw.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/bounty/create-withdraw.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/bounty/claim-withdraw.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/bounty/claim-withdraw.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/import-git.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/import-git.ts 2>/dev/null || true
scp -i $KEY ui/src/pages/api/import.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/import.ts
scp -i $KEY ui/src/pages/api/github/auth.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/github/auth.ts
scp -i $KEY ui/src/pages/api/github/callback.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/github/callback.ts
scp -i $KEY ui/src/pages/api/github/proxy.ts root@$HOST:$FRONTEND_PATH/ui/src/pages/api/github/proxy.ts
scp -i $KEY ui/src/lib/payments/lnbits-adapter.ts root@$HOST:$FRONTEND_PATH/ui/src/lib/payments/lnbits-adapter.ts 2>/dev/null || true
else
  echo "ℹ️  SKIP_REDUNDANT_SCP=1 — skipping legacy per-file scp (bulk ui/src/* above is enough)."
fi

# Always push lockfiles so server can install new deps when you change them
scp -i $KEY ui/package.json root@$HOST:$FRONTEND_PATH/ui/package.json 2>/dev/null || true
scp -i $KEY ui/yarn.lock root@$HOST:$FRONTEND_PATH/ui/yarn.lock 2>/dev/null || true

echo ""

# Public files (NIP-05 verification)
echo "🌐 Uploading public files (NIP-05 + PWA)..."
ssh -i $KEY root@$HOST "mkdir -p $FRONTEND_PATH/ui/public/.well-known"
scp -i $KEY ui/public/.well-known/nostr.json root@$HOST:$FRONTEND_PATH/ui/public/.well-known/nostr.json
scp -i $KEY ui/public/site.webmanifest root@$HOST:$FRONTEND_PATH/ui/public/site.webmanifest 2>/dev/null || true
scp -i $KEY ui/public/sw.js root@$HOST:$FRONTEND_PATH/ui/public/sw.js 2>/dev/null || true
scp -i $KEY ui/public/offline.html root@$HOST:$FRONTEND_PATH/ui/public/offline.html 2>/dev/null || true
echo ""

# Bridge Go source files (go to $FRONTEND_PATH/ui/gitnostr - same as frontend now!)
# IMPORTANT: The bridge source code is in THIS repo (ui/gitnostr/), NOT fetched from GitHub!
if [ "$SKIP_BRIDGE_ALL" != "1" ]; then
  echo "🔧 Uploading bridge (ui/gitnostr/, excluding bin/ — binaries built on server)…"
  if command -v rsync >/dev/null 2>&1; then
    rsync -az -e "ssh -i $KEY" --exclude='bin/' ui/gitnostr/ "root@$HOST:$FRONTEND_PATH/ui/gitnostr/"
  else
    echo "   (no rsync — using tar; install rsync for cleaner syncs)"
    ssh -i $KEY root@$HOST "mkdir -p $FRONTEND_PATH/ui/gitnostr"
    ( cd ui/gitnostr && tar --exclude='./bin' --exclude='bin' -cf - . ) | ssh -i $KEY root@$HOST "cd $FRONTEND_PATH/ui/gitnostr && tar -xf -"
  fi
else
  echo "ℹ️  SKIP_BRIDGE_ALL=1 — skipping gitnostr upload"
fi
echo ""

# Documentation files (go to $FRONTEND_PATH for reference)
echo "📚 Uploading documentation..."
scp -i $KEY README.md root@$HOST:$FRONTEND_PATH/ 2>/dev/null || true
scp -i $KEY docs/*.md root@$HOST:$FRONTEND_PATH/docs/ 2>/dev/null || true
echo ""

echo "✅ Files uploaded successfully!"
echo ""
echo "🔨 Building frontend on server..."
echo "   (This ensures prerender-manifest.json is created even if build has warnings)"
echo "   Note: fsevents@1.2.13 and babel peer dependency warnings from react-qrbtf > react-scripts are expected/harmless"
if [ "$SKIP_YARN_INSTALL" = "1" ]; then
  echo "   SKIP_YARN_INSTALL=1 — running yarn build only (no yarn install)"
  ssh -i $KEY root@$HOST "cd $FRONTEND_PATH/ui && rm -rf .next node_modules/.cache && yarn build 2>&1 | tail -30"
else
  ssh -i $KEY root@$HOST "cd $FRONTEND_PATH/ui && rm -rf .next node_modules/.cache && yarn install && yarn build 2>&1 | tail -30"
fi
echo ""
echo "🔧 Ensuring prerender-manifest.json exists..."
ssh -i $KEY root@$HOST "cd $FRONTEND_PATH/ui && if [ ! -f .next/prerender-manifest.json ]; then
  echo '⚠️  prerender-manifest.json missing, creating minimal version...'
  cat > .next/prerender-manifest.json << 'EOF'
{
  \"version\": 4,
  \"routes\": {},
  \"dynamicRoutes\": {},
  \"notFoundRoutes\": [],
  \"preview\": {
    \"previewModeId\": \"development-id\",
    \"previewModeSigningKey\": \"development-key\",
    \"previewModeEncryptionKey\": \"development-encryption-key\"
  }
}
EOF
  echo '✅ Created minimal prerender-manifest.json'
fi"
echo ""
echo "🔄 Restarting frontend service..."
ssh -i $KEY root@$HOST "sudo systemctl restart gittr-frontend && sleep 2 && sudo systemctl status gittr-frontend --no-pager -l | head -10"
echo ""

# Rebuild bridge if source files were uploaded
if [ "$SKIP_BRIDGE_ALL" != "1" ]; then
  if ssh -i $KEY root@$HOST "test -f $FRONTEND_PATH/ui/gitnostr/cmd/git-nostr-bridge/state.go"; then
      echo "🔨 Rebuilding bridge binary (source files were uploaded)..."
      echo "   This ensures the bridge includes all recent changes (NIP34, state event handling, etc.)"
      ssh -i $KEY root@$HOST "sudo systemctl stop git-nostr-bridge 2>/dev/null || true"
      ssh -i $KEY root@$HOST "sudo -u git-nostr bash -c 'cd $FRONTEND_PATH/ui/gitnostr && make git-nostr-bridge' 2>&1 | tail -20"
      if [ $? -eq 0 ]; then
          echo "✅ Bridge rebuilt successfully"
          echo "🔄 Restarting bridge service..."
          ssh -i $KEY root@$HOST "sudo systemctl start git-nostr-bridge && sleep 2 && sudo systemctl status git-nostr-bridge --no-pager -l | head -10"
      else
          echo "⚠️  Bridge rebuild failed - check logs above"
          echo "   You may need to manually rebuild: sudo -u git-nostr bash -c 'cd $FRONTEND_PATH/ui/gitnostr && make git-nostr-bridge'"
      fi
  else
      echo "ℹ️  No bridge source files detected - skipping bridge rebuild"
      echo "   (Bridge source files are only uploaded if they exist locally)"
  fi
else
  echo "ℹ️  SKIP_BRIDGE_ALL=1 — skipping bridge rebuild"
fi
echo ""

# sshd: git@ must read the same authorized_keys git-nostr-bridge writes (avoid stale /etc/ssh/git-authorized_keys)
if [ "$SKIP_SSHD_GIT_KEYS_FIX" != "1" ]; then
  if [[ -x "$SCRIPT_DIR/scripts/ensure-sshd-git-live-authorized-keys.sh" ]]; then
    echo "🔐 Ensuring sshd \"git\" user uses live bridge authorized_keys…"
    SSH_DEPLOY_KEY="$KEY" bash "$SCRIPT_DIR/scripts/ensure-sshd-git-live-authorized-keys.sh" "$HOST" || echo "⚠️  SSH ensure script failed — run manually: SSH_DEPLOY_KEY=$KEY $SCRIPT_DIR/scripts/ensure-sshd-git-live-authorized-keys.sh $HOST"
  elif [[ -f "$SCRIPT_DIR/scripts/ensure-sshd-git-live-authorized-keys.sh" ]]; then
    echo "⚠️  ensure-sshd-git-live-authorized-keys.sh is not executable; chmod +x scripts/ensure-sshd-git-live-authorized-keys.sh"
  fi
  echo ""
else
  echo "ℹ️  SKIP_SSHD_GIT_KEYS_FIX=1 — skipping sshd authorized_keys alignment"
  echo ""
fi

# gittr Pages (NIP-5A nsite gateway) — same host, Docker on port 3040; nginx → https://pages.gittr.space
if [ "$SKIP_GATEWAY_DEPLOY" != "1" ]; then
  if [[ -x "$SCRIPT_DIR/scripts/deploy-nsite-gateway.sh" ]]; then
    echo ""
    echo "📦 gittr Pages (nsite gateway)…"
    if bash "$SCRIPT_DIR/scripts/deploy-nsite-gateway.sh" "$HOST"; then
      echo "✅ gittr Pages stack updated"
    else
      echo "⚠️  gittr Pages deploy failed — install Docker on the server, then run: ./scripts/deploy-nsite-gateway.sh $HOST"
    fi
  elif [[ -f "$SCRIPT_DIR/scripts/deploy-nsite-gateway.sh" ]]; then
    echo ""
    echo "📦 gittr Pages (nsite gateway) — run: chmod +x scripts/deploy-nsite-gateway.sh && re-run upload, or run the script manually."
  else
    echo "ℹ️  scripts/deploy-nsite-gateway.sh missing — skip gittr Pages deploy"
  fi
else
  echo "ℹ️  SKIP_GATEWAY_DEPLOY=1 — skipping nsite gateway deploy (set SKIP_GATEWAY_DEPLOY=0 to run)"
fi

echo ""

echo "✅ Deployment complete!"
echo ""
echo "⚠️  Nginx config updates (if needed):"
echo "   nginx.gittr.conf.example has been updated with CORS headers for git.gittr.space"
echo "   To apply: ssh to server and manually edit /etc/nginx/sites-available/gittr"
echo "   Then: sudo nginx -t && sudo systemctl reload nginx"

