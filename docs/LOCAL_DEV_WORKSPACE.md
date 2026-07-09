# Local dev workspace (safe setup)

This document explains how local gittr dev is organized after the laptop migration, so you **never** overwrite GitHub or Hetzner with stale backup files.

## Where to work

| Path | Purpose |
|------|---------|
| **`~/Projects/gittr`** | **Canonical local dev** — fresh clone from GitHub `main` + auth fixes + local-only files |
| `~/Downloads/actual/ngit` | **Archive only** — old backup; do **not** deploy or push from here |
| Hetzner `/opt/ngit` | Production runtime (deployed via `upload_to_hetzner.sh`, no git on server) |
| GitHub `arbadacarbaYK/gittr` `main` | Public source of truth for **tracked code** |

## What is safe from the old backup

These files are **gitignored** and were copied from the backup into `~/Projects/gittr`:

| File | Why local-only |
|------|----------------|
| `upload_to_hetzner.sh` | Deploy script with server IP, SSH key paths |
| `.env` / `ui/.env.local` | Secrets, relay URLs, API keys |
| `.env.example` / `ui/.env.example` | May differ from GitHub templates |

Copies are also kept in `_local-only-backup/` inside the repo (gitignored by convention — do not commit).

## What must NEVER come from the backup

- **`ui/src/**`** — backup had unrelated git history and older code; GitHub `main` is newer (1000+ commits ahead of the old local HEAD)
- **`ui/gitnostr/**`** — use GitHub version unless you intentionally changed bridge code in `~/Projects/gittr`
- **Random docs** — GitHub may be newer; only merge doc edits you made deliberately in `~/Projects/gittr`

## Source-of-truth rules

1. **Code**: GitHub `origin/main` → edit in `~/Projects/gittr` → commit → push → deploy
2. **Server**: Only deploy **from `~/Projects/gittr`** after `npm run build` succeeds locally
3. **Backup folder**: Use only to recover `.env.local`, `upload_to_hetzner.sh`, etc.

## Quick start

```bash
# One-time or refresh (preserves local-only files from backup)
~/Projects/gittr/scripts/setup-local-dev.sh

# Daily dev
cd ~/Projects/gittr/ui
npm run dev
# → http://localhost:3000
```

## Deploy to Hetzner (after local build passes)

```bash
cd ~/Projects/gittr
# Script refuses to run if git working tree has unsaved changes
./upload_to_hetzner.sh
```

## Auth fix (remote signer)

Unified signing lives in `ui/src/lib/nostr/signer.ts`. All push/issue/profile flows use `resolveNostrSigner()` / `resolveSigningCredentials()` so NIP-46 remote signers work (not just NIP-07/nsec).

See also: `docs/NIP46_REMOTE_SIGNER_INTEGRATION.md`

## Verifying server vs GitHub

Server has **no git repo** — files are rsync'd. To compare a file:

```bash
ssh root@YOUR_HOST md5sum /opt/ngit/ui/src/lib/nostr/remoteSigner.ts
git show origin/main:ui/src/lib/nostr/remoteSigner.ts | md5sum
```

If they match, server matches GitHub for that file.
