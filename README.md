# [gittr.space](https://gittr.space)

**gittr** is a website for git on Nostr ([NIP-34](https://gittr.space/nostr-git)). Issues, pull requests, and the repo announcement are signed events. The git files sit on the Nostr git servers listed under **Nostr Backups**. gittr is one of those servers when its address is on that list.

[gittr.space](https://gittr.space) · [Pages](https://pages.gittr.space) · [Apps](https://gittr.space/apps) · [Help](https://gittr.space/help) · [Relay](https://relay.gittr.space)

## How it compares

**oldschool gits** are GitHub, GitLab, Codeberg, Gitea. **nostr git clients** are ngit, gitworkshop, gitplaza, and similar. **gittr** is this website. **✓** means it has it.

| | oldschool gits | nostr git clients | gittr |
| --- | --- | --- | --- |
| Public or private | ✓ | ✗ | ✓ |
| Pull requests and issues | ✓ | ✓ | ✓ |
| Branches | ✓ | command line writes, site mostly reads | ✓ |
| Releases | on the forge | can show them | create and push |
| Release assets | per repo | can show them | Apps and Zapstore |
| Pages | ✓ | ✗ | ✓ |
| Discussion boards | ✓ | ✗ | ✓ |
| Planning | ✓ | ✗ | open issues on a board |
| Notifications | ✓ | ✗ | ✓ plus CVE alerts |
| Account | their login | your Nostr key | Nostr key, plus linked identities |
| Git hosting | their servers | you name your own host | import from those forges |
| Finding repos | their search | across Nostr | Nostr and web search |
| How you use it | site, often an app | command line writes; site mostly reads | site, app, and agents |
| SSH keys | on their servers | ✗ | ✓ plus a security scan |
| Themes | ✗ | ✗ | ✓ |
| Lightning | ✗ | zaps | zap splits and bounties |
| Dependencies | ✗ | ✗ | per repo, plus a Lab page |

## What you can do

- Import from GitHub, GitLab, Codeberg, or Forgejo, then Push to Nostr. A fork is different: it copies the parent’s files into a new repo.
- Or create a repo here and Push to Nostr.
- Issues, pull requests, and a To do board.
- Pages, an apps catalog, and Lightning bounties.
- A phone app for Zapstore and F-Droid. [android-app/README.md](android-app/README.md)
- Latest public activity on Home.
- Two phone-home tiles. [Add them](https://gittr.space/omalauncher).
- Agents through [gittr-mcp](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-mcp).

| Easy to miss | What it means |
| --- | --- |
| Source | stays the forge you imported from |
| Nostr Backups | the git servers that have the files |
| Imported ticket | keeps its old number; close it on that forge |
| Bounty | pays when the pull request is merged on gittr |
| App announce | lists the app. The installer stays out of the git files. A note you have not announced stays in this browser |
| Website Push | one snapshot. SSH push keeps the old history. [SSH guide](docs/SSH_GIT_GUIDE.md) |
| Big import | can fail around 4 MB |
| This browser | holds your keys. Clearing it does not unpublish the repo |

If the host in **Source** is gone, follow [Help](https://gittr.space/help#when-source-goes-offline). Confirm a Nostr Backups address before you treat it as a copy.

If Chrome asks to access devices on your local network, block it. gittr.space does not need that.

## Where the pieces are

![gittr platform map](docs/gittr-platform.gif)

[Interactive map](docs/gittr-platform.netdraw.json) · [still frame](docs/gittr-platform.png) · [where the Code tab gets files](docs/file-fetch.gif) · [that story in words](docs/FILE_FETCHING_INSIGHTS.md)

| Piece | Where | Job |
| --- | --- | --- |
| **gittr** (this repo) | [gittr](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?branch=main) · `gittr.space` | The website |
| **gitnostr** | [gitnostr](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gitnostr?branch=main) · `git.gittr.space` | Git over SSH and HTTPS |
| **Pages** | [nsite-gateway](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/nsite-gateway) · `pages.gittr.space` | Static sites |
| **Blossom** | [gittr-blossom](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-blossom?branch=master) · `blossom.gittr.space` | Files for Pages and app listings |
| **Relay** | [pyramid](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/pyramid) · `relay.gittr.space` | Forge relay |
| **gittr-mcp** | [gittr-mcp](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-mcp) | The same platform for agents |
| **Snippets** | [gittr-helper-tools](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-helper-tools?branch=main) | Copy-paste bits and the Page cookbook |
| **ngit** | [ngit](https://github.com/DanConwayDev/ngit-cli) | `nostr://` remotes. Same events, different program |

A repo address is a Nostr identity plus a name. A `Name/repo` link opens that same repo. Publish to `wss://relay.gittr.space` and to other relays too.

## Other Nostr git tools

gittr runs **gitnostr**. **ngit** is a different program. They read the same events. Push on gittr.space is SSH or HTTPS, not the ngit command. [gitnostr vs ngit](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gitnostr?branch=main).

| Layer | Project | Role |
| --- | --- | --- |
| Protocol | [NIP-34](https://github.com/nostr-protocol/nips/blob/master/34.md) + [GRASP](https://ngit.dev/grasp/) | Signed repo, issue, and pull-request events |
| Git server | [gitnostr](https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gitnostr?branch=main) | The git server in this repo. [Self-host it](docs/GIT_NOSTR_BRIDGE_SETUP.md) |
| Website | [gittr](https://gittr.space) | This repo |
| Website | [gitworkshop](https://gitworkshop.dev) | Pairs with ngit |
| Command line | [ngit](https://ngit.dev) | `nostr://` remotes |
| Desktop | [gitplaza](https://gitplaza.netlify.app) | Linux app. No git server of its own |

Names that look related and are not this project ([awesome-nostr](https://github.com/aljazceru/awesome-nostr#git)):

| Project | What it is |
| --- | --- |
| [nak](https://github.com/fiatjaf/nak) | Nostr command line. `nak git` clones NIP-34 repos |
| [gitstr](https://github.com/fiatjaf/gitstr) | Old patch tool. Use `nak git` |
| [git-nostr-tools](http://git.jb55.com/git-nostr-tools) | Patches over Nostr |
| [git-nostr](https://github.com/colealbon/git-nostr) | Early experiment, own event tags |
| [Zapounty](https://github.com/ZigBalthazar/zapounty) | Lightning bounties on GitHub issues |
| [NostrGit](https://github.com/NostrGit/NostrGit) | Old website template |

### Reach the git

| Way | On gittr.space | Note |
| --- | --- | --- |
| SSH or HTTPS | yes | `git@git.gittr.space:<npub>/repo.git` — [guide](docs/SSH_GIT_GUIDE.md) |
| Your own gitnostr | yes | [Bridge setup](docs/GIT_NOSTR_BRIDGE_SETUP.md) |
| `gn` | yes | From a terminal. The git server watches relays |
| `nostr://` | if you install it | Needs [git-remote-nostr](https://github.com/DanConwayDev/ngit-cli) on your machine |
| Iris `htree://` | shown | Opening it needs `git-remote-htree` |
| `nak git` | install it yourself | Same events, different command |
| Agents | yes | [gittr-mcp](https://github.com/arbadacarbaYK/gittr-mcp#install-5-minutes) |

## Stack

| Layer | Tech |
| --- | --- |
| Website | Next.js 16, React 19, TypeScript, Tailwind |
| Nostr | `nostr-relaypool`, `nostr-tools` |
| Git server | [ui/gitnostr/](ui/gitnostr/) (`git-nostr-bridge`, SSH, `gn`) |
| Page and app files | Blossom. Git objects stay on the git servers |
| Payments | Lightning zaps, LNbits, NWC, LNURL |

## Docs

- [gittr-docu](https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qkgittr-docu.pages.gittr.space/) — the docs site
- [gittr-snips](https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qkgittr-snips.pages.gittr.space/) — cookbook
- [Nostr schemata](https://gittr.space/npub1zafcms4xya5ap9zr7xxr0jlrtrattwlesytn2s42030lzu0dwlzqpd26k5/schemata?file=README.md)
- [SETUP_INSTRUCTIONS.md](docs/SETUP_INSTRUCTIONS.md) — production. Do not copy the server’s notification files up from a laptop
- [LOCAL_SETUP.md](docs/LOCAL_SETUP.md) — on your machine
- [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) — ops
- [SSH_GIT_GUIDE.md](docs/SSH_GIT_GUIDE.md) — clone and push
- [GRASP_RELAY_SETUP.md](docs/GRASP_RELAY_SETUP.md) — your own relay
- [FILE_FETCHING_INSIGHTS.md](docs/FILE_FETCHING_INSIGHTS.md) — where Code-tab files come from
- [NIPS_AND_EVENT_KINDS.md](docs/NIPS_AND_EVENT_KINDS.md) — event kinds
- [NIP46_REMOTE_SIGNER_INTEGRATION.md](docs/NIP46_REMOTE_SIGNER_INTEGRATION.md) — Amber and Primal sign-in
- [SEO.md](docs/SEO.md) — public URLs
- [Help → Releases](https://gittr.space/help#releases)

Still rough: branch and tag UI, pull-request conflicts, a commit graph, CI.

## License

This website is **AGPL-3.0** ([ui/LICENSE](ui/LICENSE)). The git server in [ui/gitnostr/](ui/gitnostr/) is **MIT** ([LICENSE.md](ui/gitnostr/LICENSE.md)). [NostrGit](https://github.com/NostrGit/NostrGit) was an older website template, not that server.

## Support

Telegram: [https://t.me/gittrspace](https://t.me/gittrspace)

Nostr: [https://njump.me/npub1nur7st367ys7cqtjyv74alu84y209zsw8wagpxvrl3g9q2veqzuqjqh65s](https://njump.me/npub1nur7st367ys7cqtjyv74alu84y209zsw8wagpxvrl3g9q2veqzuqjqh65s)

[Legal](https://gittr.space/legal)
