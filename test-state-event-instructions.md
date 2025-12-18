# Testing State Event Handler (HEAD-only events)

This guide explains how to test the state event handler fix **locally without publishing to Nostr**.

## The Fix

The bridge now correctly handles state events that contain **only a HEAD tag** (no refs). Previously, it would return early and skip the HEAD update.

## Test Method

We use the bridge's **HTTP API endpoint** (`/api/event`) which accepts events directly without publishing to Nostr relays. This is perfect for local testing!

## Prerequisites

1. **Bridge must be running** with HTTP API enabled:
   ```bash
   cd ui/gitnostr
   BRIDGE_HTTP_PORT=8080 ./bin/git-nostr-bridge
   ```

2. **Test script** is ready:
   ```bash
   ./test-state-event-head-only.sh
   ```

## Running the Test

1. **Start the bridge** (in one terminal):
   ```bash
   cd ui/gitnostr
   BRIDGE_HTTP_PORT=8080 ./bin/git-nostr-bridge
   ```

2. **Run the test script** (in another terminal):
   ```bash
   cd /home/homie/Downloads/actual/ngit
   ./test-state-event-head-only.sh
   ```

3. **Check bridge logs** for:
   - `📊 [Bridge] Processing repository state event`
   - `📌 [Bridge] State event HEAD: refs/heads/main`
   - `🔄 [Bridge] Processing state event` (should NOT return early)
   - `✅ [Bridge] Updated HEAD to refs/heads/main` (or error if repo doesn't exist, which is expected)

## What to Verify

✅ **Success indicators:**
- Event is accepted (HTTP 200)
- Bridge logs show "Processing state event" (not returning early)
- Bridge attempts HEAD update (logs show HEAD update attempt)

⚠️ **Expected warnings:**
- "Repository does not exist" - This is expected since we're using a test repo name
- The important thing is that the function **doesn't return early** and **attempts the HEAD update**

## Alternative: Manual Test

You can also manually send a test event using `curl`:

```bash
curl -X POST http://localhost:8080/api/event \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test123",
    "pubkey": "0000000000000000000000000000000000000000000000000000000000000000",
    "created_at": 1234567890,
    "kind": 30618,
    "tags": [
      ["d", "test-repo"],
      ["HEAD", "ref: refs/heads/main"]
    ],
    "content": "",
    "sig": "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
  }'
```

## Code Verification

The fix is in `ui/gitnostr/cmd/git-nostr-bridge/state.go` line 82:

```go
// Only return early if there are no refs AND no HEAD to update
if len(refsToUpdate) == 0 && headRef == "" {
    return nil
}
```

This ensures that:
- ✅ State events with only HEAD tag → HEAD update executes
- ✅ State events with only refs → Refs update executes  
- ✅ State events with both → Both execute
- ✅ Empty state events → Returns early (correct)

