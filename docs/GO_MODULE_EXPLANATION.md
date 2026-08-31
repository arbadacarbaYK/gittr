# Go Module Path Explanation

## Why does the code import `github.com/arbadacarbaYK/gitnostr`?

The bridge code in `ui/gitnostr/` imports packages using paths like:
```go
import (
    "github.com/arbadacarbaYK/gitnostr"
    "github.com/arbadacarbaYK/gitnostr/bridge"
)
```

**This does NOT mean the code comes from GitHub!**

## How Go Modules Work

In Go, the module path in `go.mod` is just a **unique identifier** - it doesn't mean the code is actually hosted at that URL. It's similar to how Java uses package names or Python uses module paths.

### The Module Path is Just an Identifier

Looking at `ui/gitnostr/go.mod`:
```go
module github.com/arbadacarbaYK/gitnostr
```

This declares that the module is named `github.com/arbadacarbaYK/gitnostr`. This is:
- **Just an identifier** - doesn't require the code to be on GitHub
- **Standard Go practice** - using a URL-like path as the module identifier
- **All source is local** - the actual code is in `ui/gitnostr/` in this repo

### Why Use a GitHub-Like Path?

1. **Uniqueness**: Ensures the module path is globally unique
2. **Convention**: Standard Go practice, even for private/local modules
3. **Future-proofing**: If the code is ever published to GitHub, the imports don't need to change

### Where is the Actual Code?

All bridge source code is in **this repo** at:
- `ui/gitnostr/cmd/git-nostr-bridge/` - Bridge main program
- `ui/gitnostr/cmd/git-nostr-ssh/` - SSH server
- `ui/gitnostr/bridge/` - Bridge library code
- `ui/gitnostr/protocol/` - Protocol definitions

Deployment is whatever process you use to put this repo onto your server (rsync, CI, etc.); the bridge binaries are built from local `ui/gitnostr/` sources.

### Indirect dependency pins (security)

`ui/gitnostr/go.mod` keeps two indirect modules above their advisory floors so the Dependencies tab (OSV) and similar scans stay clean:

| Module | Pin | Why |
|--------|-----|-----|
| `github.com/gorilla/websocket` | **v1.5.3+** | Used at runtime: `git-nostr-bridge` → `go-nostr` → WebSocket to relays. GHSA-w67g-5rqw-f597 / GO-2026-6278 (mask keys must come from `crypto/rand`, not `math/rand`). |
| `golang.org/x/mod` | **v0.40.0+** | **Not linked into the bridge binary** (`go mod why` reports the main module does not need it). It sits in the graph via `modernc.org/sqlite` → ccgo → `x/tools`. Still pinned so CVE-2026-56864 / CVE-2026-56865 (sumdb/tlog) do not light up as confirmed findings. Those CVEs matter for `cmd/go` / module download, not for serving git over Nostr. |

Do not drop these back when running `go mod tidy` unless you have replaced the parent (`go-nostr` / sqlite stack) with versions that already require the patched range.

These pins live in **two git trees that are not auto-synced**: this monorepo (`ui/gitnostr/`) and the standalone [gitnostr](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gitnostr?branch=main) repo. Production builds from the gittr copy. Opening gitnostr’s Dependencies tab scans **that** repo’s `go.mod`, so the same bump has to be committed there too or the old advisories stay.

### Summary

- ✅ **Module path**: `github.com/arbadacarbaYK/gitnostr` (just an identifier)
- ✅ **Actual source**: `ui/gitnostr/` in this repo
- ✅ **Deployment**: Your normal server rollout from this repo (not a separate Go download)
- ❌ **NOT from GitHub**: The code is not fetched from GitHub, it's all local

This is standard Go practice and is completely normal!

