# GRASP relays

[GRASP](https://ngit.dev/grasp/) (Git Relays Authorized via Signed-Nostr Proofs) uses Nostr events as source of truth; multiple git hosts can mirror the same repo.

**Not the same as git-nostr-bridge:** the bridge on your VPS serves **your** bare repos. A GRASP **relay** is a public (or self-hosted) Nostr relay that also speaks NIP-34 git — used for discovery and cloning from the network.

Bridge setup: [GIT_NOSTR_BRIDGE_SETUP.md](GIT_NOSTR_BRIDGE_SETUP.md).

## Public relays

Default list is in `ui/.env.example` → `NEXT_PUBLIC_NOSTR_RELAYS`. Include GRASP-capable `wss://` URLs your deployment relies on (e.g. `wss://relay.gittr.space`, `wss://relay.ngit.dev`, `wss://gitnostr.com`, `wss://git.shakespeare.diy`) plus a short set of healthy general relays (`damus.io`, `nos.lol`, `primal.net`, …). Skip unreachable hosts from the *default* connect list (DNS-dead or chronic handshake stalls) — they can still appear in other people’s `clone` tags for read. Push auto-mirrors use `GRASP_SERVERS_FOR_PUSHING` ∪ user kind 10317 (`mergeGraspHostsForPush`).

Match the same URLs in `git-nostr-bridge.json` → `relays`.

## Event kinds

Your relay must allow the kinds gittr uses. Full list: [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md).

**nostr-rs-relay** (`config.toml`):

```toml
# allow all kinds, or e.g.:
# allowed_kinds = [0, 1, 5, 50, 51, 52, 1111, 1337, 1618, 1619, 1621, 1630, 1631, 1632, 1633, 1985, 30617, 30618, 9735, 10018, 35128]
```

Restart the relay after changes.

**strfry:** set `eventKinds.allow` to the same set (see NIPS doc).

## Pyramid (`relay.gittr.space`) notes

- **`limits.max_indexable_tags`:** set to **64** (upstream default **14**). Larger NIP-65 kind `10002` lists and forge events with many single-letter tags otherwise get `blocked: too many indexable tags`.
- **`open_kinds_spec`:** includes forge + social kinds (and `10002` / `10050`). “Members” on Pyramid is **not** a write whitelist for these kinds — anyone can publish open kinds.
- **nostr.watch listing:** your kind `10002` advertising `wss://relay.gittr.space` is a discovery *hint*, not the listing itself. nostr.watch mainly shows relays after **NIP-66 monitors** publish kind **30166** checks. Keep the relay publicly reachable with a healthy NIP-11; appearance can take time (seed + monitor cycles), not instant.

## Self-hosted GRASP

Follow upstream ngit/GRASP docs for your relay binary and git HTTP endpoint. Point gittr’s env and bridge config at your `wss://` URL.

Verify: publish a kind **30617** from gittr, confirm the relay accepts it and that `POST /api/nostr/repo/clone` can reach your HTTPS clone URL from the app server.

## Client interop

gittr emits NIP-34 tags expected by **ngit and other Nostr git clients** (HTTPS `clone` rows, hex `maintainers`, kind **30618** state with commit SHAs). Details: [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md).
