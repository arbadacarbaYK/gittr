# Contribution Proposal: gittr.space Enhancements to ngit-relay

This document outlines the enhancements made by gittr.space to the git-nostr-bridge that could benefit the broader GRASP ecosystem, particularly ngit-relay implementations.

## Overview

gittr.space has been the first major web UI client to seriously use GRASP servers (beyond gitworkshop.dev's CLI tools). In the process of building a production-ready web interface, we've identified and solved several real-world problems that CLI-only usage didn't encounter.

## Key Enhancements for Contribution

### 1. HTTP Fast Lane / Direct Bridge API ⚡ **HIGH PRIORITY**

**Problem**: When a user pushes a repository via web UI, the event is published to relays, but the bridge must wait for relay propagation (10-60 seconds) before processing. This creates a poor UX where users see "Published (Awaiting Bridge)" status for extended periods.

**Solution**: Added `/api/event` HTTP endpoint to git-nostr-bridge that accepts signed Nostr events directly. The web UI sends events to this endpoint immediately after publishing to relays, enabling instant processing.

**Implementation**:
- HTTP server on configurable port (default: 8080, via `BRIDGE_HTTP_PORT` env var)
- Accepts POST requests with signed Nostr event JSON
- Validates event signature and structure
- Processes events immediately without waiting for relay propagation

**Code Location**: `ui/gitnostr/cmd/git-nostr-bridge/main.go` lines 247-352

**Benefits**:
- **Instant processing**: Events processed in <1 second vs 10-60 seconds
- **Better UX**: Users see "Live on Nostr" status immediately
- **Backward compatible**: Still subscribes to relays as fallback
- **Optional**: Can be disabled by not setting `BRIDGE_HTTP_PORT`

**Documentation**: See `docs/STANDALONE_BRIDGE_SETUP.md` section 6

### 2. Event Deduplication Cache 🔄 **HIGH PRIORITY**

**Problem**: When using HTTP fast lane, the same event can arrive via both:
1. Direct HTTP submission (immediate)
2. Relay subscription (delayed)

Without deduplication, the bridge would process the same event twice, causing duplicate repository creation and wasted resources.

**Solution**: In-memory deduplication cache (`seenEventIDs` map) that tracks processed event IDs. Events are checked against cache before processing, and duplicates are silently ignored.

**Implementation**:
- Thread-safe map with RWMutex for concurrent access
- Automatic cleanup (keeps last 10,000 entries)
- Works for both HTTP and relay-sourced events

**Code Location**: `ui/gitnostr/cmd/git-nostr-bridge/main.go` lines 314-333

**Benefits**:
- **Prevents duplicate processing**: Same event processed only once
- **Resource efficient**: Minimal memory overhead
- **Thread-safe**: Handles concurrent HTTP and relay events safely

### 3. Merged Events Channel 🔀 **MEDIUM PRIORITY**

**Problem**: With both HTTP and relay event sources, we need a unified processing pipeline.

**Solution**: Single `mergedEvents` channel that receives events from both:
- `directEvents` channel (HTTP API)
- Relay subscription events

Both sources feed into the same processing loop, ensuring consistent handling regardless of source.

**Code Location**: `ui/gitnostr/cmd/git-nostr-bridge/main.go` lines 402-424

**Benefits**:
- **Unified processing**: Single code path for all events
- **Consistent behavior**: HTTP and relay events handled identically
- **Simpler architecture**: One processing loop instead of two

### 4. Watch-All Mode 👀 **LOW PRIORITY** (Already in some implementations)

**Problem**: Original gitnostr required listing specific `gitRepoOwners` in config. For public GRASP servers, you want to mirror ALL repositories.

**Solution**: When `gitRepoOwners` array is empty, bridge processes ALL repository events it sees, not just from specific pubkeys.

**Implementation**: Simple check: if `len(cfg.GitRepoOwners) == 0`, process all events.

**Code Location**: `ui/gitnostr/cmd/git-nostr-bridge/repo.go` (check for empty gitRepoOwners)

**Benefits**:
- **Public GRASP servers**: Can mirror all repos without maintaining pubkey list
- **Decentralized**: Truly open to all users
- **Backward compatible**: Existing configs with pubkeys still work

### 5. Enhanced Logging & Error Handling 📊 **MEDIUM PRIORITY**

**Problem**: Original bridge had minimal logging, making debugging difficult in production.

**Solution**: Added detailed, structured logging with emoji indicators for quick visual scanning:
- `✅` Success operations
- `❌` Errors
- `⚠️` Warnings
- `🔍` Debug/investigation
- `📥` Event reception
- `🌐` HTTP operations

**Benefits**:
- **Production debugging**: Easy to trace issues in logs
- **Visual scanning**: Emoji indicators help quickly identify problem areas
- **Structured format**: Consistent log format across all operations

### 6. NIP-34 Full Support (Kind 30617 & 30618) 📋 **ALREADY STANDARD**

**Status**: This is already part of the GRASP/NIP-34 standard, but we've ensured full compliance:
- Kind 30617: Repository announcements (replaces legacy kind 51)
- Kind 30618: Repository state (branches, tags, commit SHAs)

**Note**: We maintain backward compatibility with kind 51 for legacy repos.

## Implementation Details

### HTTP Fast Lane API

**Endpoint**: `POST /api/event`

**Request Body**: Signed Nostr event JSON
```json
{
  "id": "event_id_hex",
  "kind": 30617,
  "pubkey": "pubkey_hex",
  "created_at": 1234567890,
  "tags": [...],
  "content": "...",
  "sig": "signature_hex"
}
```

**Response**:
- `200 OK`: Event accepted and queued for processing
- `400 Bad Request`: Invalid event structure
- `403 Forbidden`: Invalid signature
- `409 Conflict`: Duplicate event (already processed)

**Security Considerations**:
- Event signature is verified before processing
- Should be behind reverse proxy with auth in production
- Currently listens on localhost only (safe for same-server deployments)

### Deduplication Cache

**Algorithm**: Simple in-memory map
- Key: Event ID (hex string)
- Value: Boolean (true = processed)
- Cleanup: Clears map when >10,000 entries (simple approach, could use LRU cache)

**Thread Safety**: Uses `sync.RWMutex` for concurrent read/write access

## Testing Recommendations

1. **HTTP Fast Lane**:
   - Test with valid signed events
   - Test with invalid signatures (should reject)
   - Test duplicate events (should return 409)
   - Test with relay subscription disabled (should still work)

2. **Deduplication**:
   - Send same event via HTTP and relay (should process once)
   - Test with high event volume (cache cleanup)
   - Test thread safety with concurrent requests

3. **Merged Channel**:
   - Test events arriving from both sources simultaneously
   - Verify no events are lost
   - Verify processing order is consistent

## Backward Compatibility

All enhancements are **backward compatible**:
- HTTP fast lane is **optional** (only enabled if `BRIDGE_HTTP_PORT` is set)
- Deduplication works with relay-only mode
- Watch-all mode is opt-in (empty `gitRepoOwners` array)
- Enhanced logging doesn't change behavior

## Documentation Updates Needed

If these enhancements are accepted, documentation should be updated:

1. **Bridge Setup Guide**: Add HTTP fast lane configuration
2. **API Documentation**: Document `/api/event` endpoint
3. **Deployment Guide**: Add reverse proxy setup for public HTTP API
4. **Troubleshooting**: Add deduplication cache debugging tips

## Contribution Format

We're happy to contribute these enhancements in any format:

1. **Pull Request**: Direct PR to ngit-relay repository
2. **Patch Files**: Standalone patches for review
3. **Documentation**: Detailed implementation guide for maintainers
4. **Discussion**: Open issue/thread to discuss approach first

## Questions for Maintainers

1. **HTTP Fast Lane**: Is this something ngit-relay wants? It's very useful for web UIs but CLI tools might not need it.

2. **Deduplication**: Should this be configurable (enable/disable)? Or always-on?

3. **Watch-All Mode**: Is this already implemented? If so, we can skip this contribution.

4. **Logging**: Are the emoji indicators acceptable, or should we use structured logging (JSON)?

5. **Testing**: What's the preferred testing approach? Unit tests, integration tests, or both?

## Contact


## Acknowledgments

These enhancements were developed while building gittr.space, the major web UI for GRASP. We're grateful to the ngit-relay maintainers and the broader GRASP community for the solid foundation that made these improvements possible.

---

**Note**: This document is a living proposal. We're open to feedback and modifications based on maintainer preferences and community needs.

