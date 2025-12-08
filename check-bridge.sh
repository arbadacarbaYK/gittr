#!/bin/bash
# Bridge Status Checker Script
# Usage: ./check-bridge.sh [repo-name] [owner-pubkey]
# Example: ./check-bridge.sh tides 9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c

set -e

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner_new}"
SERVER="${SERVER:-root@91.99.86.115}"

echo "🔍 Checking git-nostr-bridge status..."
echo ""

# Check service status
echo "📊 Service Status:"
ssh -i "$SSH_KEY" "$SERVER" "sudo systemctl status git-nostr-bridge --no-pager | head -12" || true
echo ""

# Check recent logs
echo "📋 Recent Logs (last 20 lines):"
ssh -i "$SSH_KEY" "$SERVER" "sudo journalctl -u git-nostr-bridge --since '10 minutes ago' --no-pager | tail -20" || true
echo ""

# Check bridge HTTP server status
echo "🌐 Bridge HTTP Server Status (port 8080):"
ssh -i "$SSH_KEY" "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/event -X POST -d '{}' -H 'Content-Type: application/json'" | grep -q "400" && echo "  ✅ HTTP server is listening (returned 400 for invalid event, which is expected)" || echo "  ❌ HTTP server not responding on port 8080"
echo ""

# If repo name and pubkey provided, check specific repo
if [ -n "$1" ] && [ -n "$2" ]; then
    REPO_NAME="$1"
    OWNER_PUBKEY="$2"
    
    echo "🔍 Checking repository: $REPO_NAME (owner: ${OWNER_PUBKEY:0:8}...)"
    echo ""
    
    # Check if repo exists in filesystem
    echo "📁 Filesystem Check:"
    ssh -i "$SSH_KEY" "$SERVER" "sudo -u git-nostr ls -la /home/git-nostr/git-nostr-repositories/${OWNER_PUBKEY}/${REPO_NAME}.git 2>&1 | head -5" || echo "  ❌ Repository not found in filesystem"
    echo ""
    
    # Check bridge API
    echo "🌐 Bridge API Check:"
    curl -s "https://gittr.space/api/nostr/repo/files?ownerPubkey=${OWNER_PUBKEY}&repo=${REPO_NAME}&branch=main" | head -100 || echo "  ❌ API request failed"
    echo ""
    
    # Check if repo exists in database (if sqlite3 available)
    echo "💾 Database Check:"
    # Try to read database path from config, fallback to default
    DB_PATH=$(ssh -i "$SSH_KEY" "$SERVER" "sudo -u git-nostr cat /home/git-nostr/.config/git-nostr/git-nostr-bridge.json 2>/dev/null | grep -o '\"DbFile\":\"[^\"]*\"' | cut -d'\"' -f4" || echo "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite")
    if [ -z "$DB_PATH" ] || [ "$DB_PATH" = "/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite" ]; then
        DB_PATH="/home/git-nostr/.config/git-nostr/git-nostr-db.sqlite"
    fi
    ssh -i "$SSH_KEY" "$SERVER" "sudo -u git-nostr sqlite3 \"$DB_PATH\" 'SELECT OwnerPubKey, RepositoryName, UpdatedAt FROM Repository WHERE RepositoryName = \"${REPO_NAME}\" AND OwnerPubKey = \"${OWNER_PUBKEY}\" LIMIT 1;' 2>&1" || echo "  ⚠️ Could not query database (sqlite3 may not be installed or database not found at $DB_PATH)"
    echo ""
    
    # Check bridge logs for this specific repo
    echo "📋 Bridge Logs for ${REPO_NAME}:"
    ssh -i "$SSH_KEY" "$SERVER" "sudo journalctl -u git-nostr-bridge --no-pager | grep -i '${REPO_NAME}' | tail -10" || echo "  No logs found for this repo"
    echo ""
fi

# Check bridge binary (try multiple possible locations)
echo "🔧 Bridge Binary:"
# Try to get path from systemd service file
BINARY_PATH=$(ssh -i "$SSH_KEY" "$SERVER" "grep ExecStart= /etc/systemd/system/git-nostr-bridge.service 2>/dev/null | cut -d'=' -f2" || echo "")
if [ -n "$BINARY_PATH" ]; then
    echo "  From systemd service: $BINARY_PATH"
    ssh -i "$SSH_KEY" "$SERVER" "ls -lh \"$BINARY_PATH\"" || echo "  ❌ Binary not found at service path"
else
    # Try common locations
    FOUND=false
    for path in "/opt/ngit/ui/gitnostr/bin/git-nostr-bridge" "/home/git-nostr/gittr/ui/gitnostr/bin/git-nostr-bridge" "/home/git-nostr/ngit/ui/gitnostr/bin/git-nostr-bridge"; do
        if ssh -i "$SSH_KEY" "$SERVER" "test -f \"$path\"" 2>/dev/null; then
            echo "  Found at: $path"
            ssh -i "$SSH_KEY" "$SERVER" "ls -lh \"$path\""
            FOUND=true
            break
        fi
    done
    if [ "$FOUND" = false ]; then
        echo "  ⚠️ Could not locate bridge binary in common locations"
    fi
fi
echo ""

# Check connected relays
echo "📡 Connected Relays (from recent logs):"
ssh -i "$SSH_KEY" "$SERVER" "sudo journalctl -u git-nostr-bridge --since '5 minutes ago' --no-pager | grep 'relay connected' | tail -10" || true
echo ""

echo "✅ Bridge check complete!"

