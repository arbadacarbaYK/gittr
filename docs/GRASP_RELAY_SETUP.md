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

- **Web dashboard vs `wss://`:** `https://relay.gittr.space/` is Pyramid’s Tailwind UI (invite tree, login, settings). **`wss://relay.gittr.space`** is the Nostr relay. An unstyled “90s HTML” page (huge Giza photo, default blue links) means **`/static/styles.css` 404** — the binary was built without Tailwind. CSS is gitignored and embedded at compile time; rebuild from [arbadacarbaYK/pyramid](https://github.com/arbadacarbaYK/pyramid) with `just build` or `easy.sh` (npm + tailwind before `go build`). Check: `curl -sI https://relay.gittr.space/static/styles.css` should be **200**, not 404. The git clone host (`git.gittr.space`) is separate and has no website.
- **Dashboard login (remote signer):** **login** opens the `window.nostr.js` Amber/bunker panel (paste `bunker://…` or scan the QR). After the Tailwind CSS embed, that panel could sit off-screen because the library injects `overflow: auto` on `html`/`body` and Tailwind’s flex layout then treats `position: fixed` as the document bottom. Pyramid now sets `disableOverflowFix: true` (see pyramid `FORGE.md`). NIP-46 bunker traffic still uses public signer relays from the bunker URI — not `wss://relay.gittr.space`.
- **`limits.max_indexable_tags`:** set to **64** (upstream default **14**). Larger NIP-65 kind `10002` lists and forge events with many single-letter tags otherwise get `blocked: too many indexable tags`.
- **`open_kinds_spec`:** includes forge + social kinds (and `10002` / `10050`). “Members” on Pyramid is **not** a write whitelist for these kinds — anyone can publish open kinds.
- **gittr Settings → Relays:** **Your Relays (NIP-65)** is the logged-in user’s kind `10002` (status, edit, publish with their signer). Platform defaults are read-only.
- **nostr.watch listing:** your kind `10002` advertising `wss://relay.gittr.space` is a discovery *hint*, not the listing itself. nostr.watch mainly shows relays after **NIP-66 monitors** publish kind **30166** checks. Keep the relay publicly reachable with a healthy NIP-11; appearance can take time (seed + monitor cycles), not instant.
  - Kind `10002` must also be visible on **public** discovery relays (`nos.lol`, `primal`, `purplepag.es`, `relay.nostr.watch`, …) — not only on `relay.gittr.space` — or trawlers never learn the URL.
  - gittr runs a small on-box **NIP-66 relaymon** (`/opt/ngit/relaymon`, systemd timer `gittr-relaymon.timer`) that probes `wss://relay.gittr.space` and publishes kinds `10166` + `30166` every ~15 minutes. That is what makes the relay appear in the monitoring graph; Settings → Relays alone is not enough.
  - **Operator panel:** NIP-11 `pubkey` must be the **platform** identity (Pyramid `relay_operator_pubkey`), with that identity’s kind `0` + kind `10002` = **env platform relays only**. Do **not** point NIP-11 at a human root/Amber key — that made nostr.watch show personal relays and confused “owner”. Platform env (`NEXT_PUBLIC_NOSTR_RELAYS`) never reads from that list. Amber/NWC keep their own transports.
  - **NIP-11 `software`:** use a normal forge URL such as `https://github.com/fiatjaf/pyramid`. nostr.watch’s `makeSoftwareReadable()` treats any hostname containing `"git"` (including `gittr.space`) as `owner/repo` and drops the link-friendly form — a long `https://gittr.space/npub…/pyramid` shows up as bare `npub…/pyramid`. Keep gittr attribution in `version` (e.g. `gittr-platform-op-…`).
  - **NIP-05:** platform kind `0` should set `"nip05": "relay@gittr.space"`. `ui/public/.well-known/nostr.json` must map local-part `"relay"` (not `"relay@gittr.space"`) to the platform hex pubkey, and the site must send `Access-Control-Allow-Origin: *` on that path.
  - **If nostr.watch Overview still says “Could not locate operator's relay list”** while NIP-11 looks correct: our side is usually fine (kind `0`/`10002` on `purplepag.es` + `user.kindpag.es`, and fresh `30166` on `relaypag.es` embedding the platform pubkey). The Overview card only *reads* memory and does not reliably fetch; open the operator page directly (`/operators/<platform-hex>`) to force `sync:operator:meta`. Prefer publishing `30166` to **`wss://relaypag.es`** (accepts our monitor); `wss://relay.nostr.watch` often times out on write and can keep a stale check with an old `pubkey`. Extra NIP-11 fields (`self`, `supported_grasps`) and NIP-42 audit false negatives are expected for this stack.

## Self-hosted GRASP

Follow upstream ngit/GRASP docs for your relay binary and git HTTP endpoint. Point gittr’s env and bridge config at your `wss://` URL.

Verify: publish a kind **30617** from gittr, confirm the relay accepts it and that `POST /api/nostr/repo/clone` can reach your HTTPS clone URL from the app server.

## Client interop

gittr emits NIP-34 tags expected by **ngit and other Nostr git clients** (HTTPS `clone` rows, hex `maintainers`, kind **30618** state with commit SHAs). Details: [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md).
