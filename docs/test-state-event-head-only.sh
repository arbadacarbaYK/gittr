#!/bin/bash
# Test script to verify state event handler processes HEAD-only events correctly
# This sends a mock event directly to the bridge's HTTP API without publishing to Nostr

set -e

BRIDGE_HTTP_PORT="${BRIDGE_HTTP_PORT:-8080}"
BRIDGE_URL="http://localhost:${BRIDGE_HTTP_PORT}/api/event"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧪 Testing state event handler with HEAD-only event${NC}"
echo ""

# Check if bridge is running
if ! curl -s "http://localhost:${BRIDGE_HTTP_PORT}/api/event" > /dev/null 2>&1; then
    echo -e "${RED}❌ Bridge HTTP API not accessible at ${BRIDGE_URL}${NC}"
    echo "   Make sure the bridge is running with BRIDGE_HTTP_PORT=${BRIDGE_HTTP_PORT}"
    echo "   Start it with: cd ui/gitnostr && BRIDGE_HTTP_PORT=${BRIDGE_HTTP_PORT} ./bin/git-nostr-bridge"
    exit 1
fi

echo -e "${GREEN}✅ Bridge HTTP API is accessible${NC}"
echo ""

# Generate a test pubkey (64 hex chars)
TEST_PUBKEY="$(openssl rand -hex 32)"
TEST_REPO_NAME="test-repo-head-only-$(date +%s)"

# Create a mock state event with ONLY a HEAD tag (no refs)
# This tests the fix: state events with only HEAD should still update HEAD
STATE_EVENT=$(cat <<EOF
{
  "id": "$(openssl rand -hex 32)",
  "pubkey": "${TEST_PUBKEY}",
  "created_at": $(date +%s),
  "kind": 30618,
  "tags": [
    ["d", "${TEST_REPO_NAME}"],
    ["HEAD", "ref: refs/heads/main"]
  ],
  "content": "",
  "sig": "$(openssl rand -hex 64)"
}
EOF
)

echo -e "${YELLOW}📤 Sending state event with ONLY HEAD tag (no refs)...${NC}"
echo "   Event details:"
echo "   - Kind: 30618 (state event)"
echo "   - Repo: ${TEST_REPO_NAME}"
echo "   - Tags: [\"d\", \"${TEST_REPO_NAME}\"], [\"HEAD\", \"ref: refs/heads/main\"]"
echo "   - No refs tags (this is the test case!)"
echo ""

# Send event to bridge
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d "${STATE_EVENT}" \
  "${BRIDGE_URL}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Event accepted by bridge (HTTP ${HTTP_CODE})${NC}"
    echo "   Response: ${BODY}"
    echo ""
    echo -e "${YELLOW}📋 Check bridge logs for:${NC}"
    echo "   1. '📊 [Bridge] Processing repository state event'"
    echo "   2. '📌 [Bridge] State event HEAD: refs/heads/main'"
    echo "   3. '🔄 [Bridge] Processing state event' (should NOT return early)"
    echo "   4. '✅ [Bridge] Updated HEAD to refs/heads/main'"
    echo ""
    echo -e "${GREEN}✅ Test event sent successfully!${NC}"
    echo ""
    echo -e "${YELLOW}💡 Note:${NC} The bridge will log a warning that the repo doesn't exist,"
    echo "   but it should still process the HEAD tag. Check logs to verify:"
    echo "   - The function does NOT return early (line 82 check passes)"
    echo "   - HEAD update is attempted (lines 118-128 execute)"
    echo ""
else
    echo -e "${RED}❌ Event rejected by bridge (HTTP ${HTTP_CODE})${NC}"
    echo "   Response: ${BODY}"
    exit 1
fi

