#!/bin/bash
# Script to clean up orphaned push working directories on Hetzner
# These directories are left behind when chunked pushes fail before the last chunk

HOST=${1:-"91.99.86.115"}
KEY=${2:-"~/.ssh/id_ed25519_hetzner_new"}

echo "🔍 Checking for orphaned push directories on $HOST..."

# Find all gittr-push-* directories older than 1 hour
ssh -i $KEY root@$HOST "find /tmp -maxdepth 1 -type d -name 'gittr-push-*' -mmin +60 -exec ls -ld {} \; 2>/dev/null" | while read line; do
  if [ -n "$line" ]; then
    dir=$(echo "$line" | awk '{print $NF}')
    echo "  Found: $dir"
  fi
done

echo ""
echo "🧹 Cleaning up orphaned directories (older than 1 hour)..."

# Remove directories older than 1 hour
ssh -i $KEY root@$HOST "find /tmp -maxdepth 1 -type d -name 'gittr-push-*' -mmin +60 -exec rm -rf {} \; 2>/dev/null && echo '✅ Cleanup complete' || echo '📝 No orphaned directories found'"

echo ""
echo "📊 Remaining push directories:"
ssh -i $KEY root@$HOST "find /tmp -maxdepth 1 -type d -name 'gittr-push-*' 2>/dev/null | wc -l"

