# gittr Pages — gateway curation and blocklist

## Who publishes what?

| Thing | Who signs it | Where it lives |
|-------|----------------|----------------|
| **`NEXT_PUBLIC_PUBLISHER_BLOCKLIST`** | Nobody — it is **gittr config** in `ui/.env.local` (not a Nostr event). | Server only. Used by explore/repos/sitemap and as input when publishing the mute list. |
| **Kind `10000` mute list** | **gittr operator** identity (`gittr@gittr.space`, pubkey in `.well-known/nostr.json`). | On **Nostr relays** — the gateway reads it. |
| **Gateway `CURATION_USER`** | N/A — env tells the gateway **which pubkey’s** mute list to load. | `/opt/ngit/infra/nsite-gateway/.env` only. Can be **hex/npub** or **`nsec1…`** (server only; upstream uses nsec to decrypt hidden mutes if any). |

hzrd149 did **not** invent kind `10000`. It is **[NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md)** (standard Nostr lists). His gateway added **curation**: load a curator’s public **`p`** tags from that list and hide those authors from the home page, **`/status`**, and **`manifests.json`**.

The upstream gateway **does not publish** mute lists. It only **reads** them from `NOSTR_RELAYS` and the curator’s NIP-65 outboxes. Optional **`CACHE_RELAYS=ws://localhost:4869`** only caches **fetched** events to a local relay — it is not a private “push channel” for kind `10000`. gittr publishes to the same public relays in `NOSTR_RELAYS` (see **`arbadacarbaYK/nsite-gateway`** branch **`gittr-pages`**, script `scripts/publish-curation-mutelist.cjs`).

## Merge vs replace (like follow list)

NIP-51 mute lists are **replaceable events** (one current list per `d` tag per author). When you update, you publish a **new** kind `10000` whose tags must include:

1. **All existing public `p` tags** you still want, plus  
2. **Any new `p` tags** to add.

If you publish a list with **only** the new pubkey, you **replace** the whole list and drop previous mutes — the same mistake as early follow-list bugs. The script **`scripts/publish-gittr-pages-mutelist.cjs`** fetches the latest list from relays, **merges** `p` tags with `NEXT_PUBLIC_PUBLISHER_BLOCKLIST`, then publishes.

**Important:** nsite-gateway loads the curator list with **`getReplaceable(Mutelist, pubkey)`** — the **default** NIP-33 identifier **`d=""`**, not a custom name. A mute list published with `d=gittr-pages-curation` is ignored by the gateway until republished with `d=""`.

## Server setup (no secrets in GitHub)

1. **Gateway `.env`** (from `gittr-pages.production.env` + deploy):
   - `CURATION_USER` = **hex or npub only** on the gateway (reads the list). Put **`nsec1…` only in a server file** used by the publish script (`GITTR_PAGES_MUTE_NSEC` or `CURATION_USER` when running `publish-gittr-pages-mutelist.cjs`), not required in the running gateway if all mutes are public `p` tags.
   - Using **`nsec` in gateway `CURATION_USER`** makes the gateway try to **decrypt hidden mutes**; a broken encrypted list can log `Failed to load curator mute list` even when public `p` tags are fine.
   - `GITTR_SYNC_MUTED_PUBKEYS=…` — optional backup until the mute list is on relays (deploy syncs from blocklist).

2. **Publish / update the mute list** (once per blocked pubkey):

   ```bash
   cd /opt/ngit/ui
   export CURATION_USER="$(grep ^CURATION_USER= /opt/ngit/infra/nsite-gateway/.env | cut -d= -f2-)"
   node scripts/publish-gittr-pages-mutelist.cjs
   cd /opt/ngit/infra/nsite-gateway && docker compose -f docker-compose.yml -f docker-compose.gittr-gateway.yml up -d
   ```

3. **Restart gateway** after publish so it reloads the mute list (or wait for `CURATION_REFRESH`, default 600s).

## Docker image vs `.env`

| Piece | Role |
|-------|------|
| **Docker image** | Program code (upstream v3.6.2 + thin overlay). |
| **`.env` on server** | Relays, `PUBLIC_DOMAIN`, **`CURATION_USER`**, sync hex list. |

## What still uses `PUBLISHER_BLOCKLIST` on gittr.space

Explore, home, repositories, apps, sitemap — the Next.js app does not read the gateway mute list. Keep the env blocklist there unless you add those pubkeys only to kind `10000`.

## Static files and 502

See previous sections in this file: `index.html` for `/`; other assets only if listed in the manifest; 502 = Blossom/storage failure, not curation.
