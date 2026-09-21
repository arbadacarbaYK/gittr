# gittr.space repo URLs (for documentation links)

Use these **on gittr** when pointing readers at our repositories. GitHub mirrors exist for contributors who prefer git over HTTPS, but **in-app and in docs prefer gittr**.

| Repo | Browse on gittr |
|------|-----------------|
| **gittr** (web UI) | https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr |
| **gitnostr** (bridge) | https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gitnostr |
| **nsite-gateway** (Pages, our fork) | https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/nsite-gateway |
| **gittr-blossom** (Pages / nsite blobs) | Live host [blossom.gittr.space](https://blossom.gittr.space). Public code, no credentials: [arbadacarbaYK/gittr-blossom](https://github.com/arbadacarbaYK/gittr-blossom) (hzrd149/blossom-server v6.1.5, adapted for gittr Nostr git). **Pages** for everyone. The operator gittr Android APK (`space.gittr.app`) may also pin here. Third-party Apps/APKs use public Blossom hosts listed in [NIPS_AND_EVENT_KINDS.md](NIPS_AND_EVENT_KINDS.md) § NIP-82. |
| **gittr-helper-tools** | https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-helper-tools |
| **pyramid** (forge relay) | https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/pyramid |
| **gittr-mcp** (agents) | https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-mcp |
| **zapstore** (Apps catalog companion) | https://gittr.space/npub10r8xl2njyepcw2zwv3a6dyufj4e4ajx86hz6v4ehu4gnpupxxp7stjt2p8/zapstore |

**Open a file:** add `?file=path/to.md&branch=main` (example: [GITTR_PAGES_CURATION.md](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?file=docs/GITTR_PAGES_CURATION.md&branch=main)). `/nostr-git` uses the same-origin path (`GITTR_DOC_README_PATH`) so “gittr README” stays on this host and opens [README.md](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?file=README.md&branch=main). The absolute URL is `GITTR_DOC_README`.

**Nostr Pages (after Push Manifest):** each repo’s public site name is whatever the owner Saves in **Site name**. That name is 1–13 characters because the host is one DNS label (`50-char pubkey` + name, max 63). Repo slugs longer than 13 characters cannot be the Pages name as-is. Platform docs hub lives at repo-root `index.html` in **gittr** — currently listed as `gittr-docu`, URL […qkgittr-docu.pages.gittr.space](https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qkgittr-docu.pages.gittr.space/). Client cookbook is **gittr-helper-tools**, currently `gittr-snips`, URL […qkgittr-snips.pages.gittr.space](https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qkgittr-snips.pages.gittr.space/). Same-tab sibling Pages: [gitnostr](https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qkgitnostr.pages.gittr.space/), [gittr-mcp](https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qkgittr-mcp.pages.gittr.space/), [nsite-gateway](https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qknsite-gateway.pages.gittr.space/). **pyramid** hub HTML is repo-root `index.html` (needs **Push Manifest** for kind 35128). Repo slugs longer than 13 characters cannot be the Pages name as-is.

**Upstream credit (not our repo):** [hzrd146 / nsite-gateway on gittr](https://gittr.space/npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr/nsite-gateway) — we forked and adapted this for gittr Pages. GitHub: [hzrd149/nsite-gateway](https://github.com/hzrd149/nsite-gateway).
