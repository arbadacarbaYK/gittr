# gittr.space - Technical Overview & Positioning

## What is Nostr?

**Nostr (Notes and Other Stuff Transmitted by Relays) is a decentralized protocol for social networking and data transmission.** No central servers—data stored across a distributed relay network. Users control identity via cryptographic key pairs; content persists across multiple relays automatically.

**Key characteristics:**
- **Decentralized**: No single point of failure or control
- **Censorship-resistant**: Content replicated across thousands of relays
- **Open protocol**: Anyone can run a relay or build a client
- **Cryptographic identity**: Users own identity via key pairs (npub/nsec)
- **Event-based**: Data transmitted as signed events (JSON objects)

**Ecosystem**: Hundreds of thousands of active users. Major applications: social networks (Damus, Primal), decentralized marketplaces, Git hosting.

**Notable contributors:**
- **Ben Arc**: LNbits creator (Lightning wallet infrastructure) - [Nostr Profile](https://njump.to/npub1zfwrn5gnl9gml2lnr8kmarqdsd9yle7l5rvv84prz0ghjq8nerrs73sl0t)
- **fiatjaf**: Nostr protocol founder, LNURL creator (Lightning payment protocol), GRASP protocol developer - [Nostr Profile](https://njump.to/npub1yvwvq8q9jhy6xg5xvg7v8n5v8k8v8k8v8k8v8k8v8k8v8k8v8k)
- **Jack Dorsey**: Twitter/Square founder, 2022 bounty sponsor for GitHub replacement on Nostr - [Nostr Profile](https://njump.to/npub102q7y9wzcms5erwgkeh8sqqsja03q0nqqdfqgwf39pgfgkcz65ysll2um3)

## Core Value Proposition

**gittr.space is decentralized Git hosting on Nostr (NIP-34).** Repositories announced via Nostr events, stored on GRASP-compatible git servers, automatically replicated across relay network.

No single point of failure. Repositories persist across thousands of Nostr relays—resilient to outages, censorship, takedowns.

**Historical context**: 2022 Jack Dorsey bounty for GitHub replacement on Nostr. gittr.space fulfills this vision—fully functional GitHub alternative built on Nostr, leveraging DanConwayDev (ngit) and fiatjaf (GRASP protocol). Derek Ross (prominent Nostr app founder) recently highlighted gittr.space as the fulfillment.

## Technical Architecture

### Protocol & Standards
- **NIP-34 compliant**: Repository announcements (kind 30617), state events (kind 30618)
- **GRASP protocol** (fiatjaf): Interoperable with other Nostr-based git servers
- **Standard Git operations**: SSH and HTTPS via git-nostr-bridge
- **Nostr relay network**: Automatic replication across multiple relays

### Implementation
- **Frontend**: Next.js web application
- **Backend**: Go-based git-nostr-bridge (self-hostable)
- **Storage**: Bare Git repositories on GRASP servers, metadata in Nostr events
- **Authentication**: NIP-07 browser extensions, NIP-46 remote signers, stored keys
- **Payments**: Bitcoin Lightning via LNURL (fiatjaf), LNbits (Ben Arc), NWC
  - **Zaps**: Direct support for open source developers
  - **Bounties**: Issue-based funding via LNURL-withdraw—creates job market
    - Developers fund features they need or work on bounties from others
    - Addresses critical need: sustainable income for open source developers
  - **Future**: Paid repositories and software packages

### Key Differentiators

**vs GitHub/GitLab/Codeberg:**
- Decentralized—no single point of failure
- Censorship-resistant—repos across thousands of relays
- Self-sovereign—developers own data completely
- Built-in Lightning payments—no separate payment infrastructure

**vs Self-Hosted Git Server:**
- No server management—network handles redundancy
- Automatic backup across Nostr relay network
- Built-in discoverability—part of global network
- Lightning payments integrated
- **But you CAN self-host**: Open source; deploy your own bridge/relay

**vs Other Nostr Git Clients** (e.g., gitworkshop.dev, ngit):
- **Full-featured web platform** vs CLI-focused tools
- **Proper authentication** vs limited/no key management
- **Multi-source integration**—GitHub, GitLab, Codeberg, Nostr cloud unified
- **Collaboration tools**—web UI with issues, PRs, bounties, code snippets

## Current State

**Team**: Two core developers

**Status**: Fully functional with active users:
- Repository creation, import, management
- Git operations (clone, push, pull) via SSH/HTTPS
- Issue tracking and pull requests
- Bitcoin Lightning bounties (LNURL)
- Code snippet sharing (NIP-C0)
- Multi-source file fetching (GitHub/GitLab/Codeberg/GRASP servers)

**Open Source**: All code open source. Not traditional company seeking VC—part of Nostr ecosystem.

**Historical significance**: Fulfills 2022 Jack Dorsey bounty. Derek Ross highlighted gittr.space as fulfillment, built on DanConwayDev (ngit) and fiatjaf (GRASP).

## Funding Needs

**What funding enables:**

1. **Team Growth**: Hire developers to accelerate features and maintain infrastructure
2. **Infrastructure Scaling**: Support more GRASP servers and relays as userbase grows
3. **Feature Development**: Marketplace for paid repos/packages, advanced collaboration tools
4. **Security**: Professional audits and penetration testing
5. **Documentation**: Comprehensive guides, tutorials, developer resources
6. **Community**: Fund events, hackathons, developer outreach
7. **Reliability**: Redundancy and monitoring for bridges/relays
8. **Developer Tools**: CLI tools, IDE plugins, platform integrations

## Technical Advantages

### Decentralization
- Repositories announced via Nostr events (kind 30617)
- State tracked via replaceable events (kind 30618)
- Files stored on GRASP-compatible git servers (fiatjaf's protocol)
- Automatic replication across relay network
- No single point of failure

### Self-Hostability
- git-nostr-bridge self-hostable (Go-based)
- Deploy your own relay or use existing ones
- Open source—no vendor lock-in
- Push to Nostr, self-host, or both

### Multi-Source Architecture
- Automatic file fetching from:
  - GitHub/GitLab/Codeberg APIs (imported repos)
  - GRASP servers (relay.ngit.dev, gitnostr.com, etc.)
  - Nostr events (embedded files in legacy repos)
- Fallback chain ensures files always accessible

### Authentication & Security
- NIP-07 browser extensions (Flamingo, nos2x-fox, Alby)
- NIP-46 remote signers (LNbits—Ben Arc's infrastructure, Nowser, Bunker)
- Encrypted key storage (optional password protection)
- SSH key management via Nostr events (kind 52)

### Payments & Developer Economics
- **LNURL integration** (fiatjaf): Seamless Lightning payments
- **Zaps to repos**: Direct support for open source developers
- **Bounty system**: Issue-based funding creates job market
  - Developers fund features they need
  - Developers work on bounties from others
  - Addresses critical need: sustainable income for open source developers
- **Future marketplace**: Paid repos and packages with Lightning payments

## Future Roadmap

**Marketplace**: Paid repositories and software packages with Bitcoin Lightning
- Direct peer-to-peer payments—no platform fees
- LNURL-withdraw links for bounties (implemented via fiatjaf's protocol)
- Future: Paid private repos, installable packages
- Addresses critical need: sustainable income for open source developers

**Network Growth**: Participate in GRASP network expansion
- More GRASP servers = more redundancy
- Growing Nostr ecosystem = larger userbase
- Interoperability with other Nostr Git clients

## 30-Second Technical Summary

**"gittr.space is decentralized Git hosting on Nostr—censorship-resistant protocol with no central servers. Repositories announced via NIP-34 events, stored on GRASP-compatible git servers. No single point of failure—repos persist across thousands of Nostr relays. Unlike CLI-focused Nostr Git clients, gittr provides full-featured web platform with proper authentication, multi-source integration, collaboration tools. Built-in Bitcoin Lightning payments via LNURL enable zaps and bounties—addressing critical need for open source developer income. Fulfills 2022 Jack Dorsey bounty for GitHub replacement on Nostr. Open source and self-hostable. Currently maintained by two developers; seeking support to grow team, scale infrastructure, accelerate development."**

## 60-Second Technical Summary

**"gittr.space implements decentralized Git hosting using Nostr—protocol for censorship-resistant social networking and data transmission. Nostr has no central servers; data stored across distributed relay network. Users control identity via cryptographic key pairs; content persists across multiple relays automatically. Nostr ecosystem: hundreds of thousands of users, developed by contributors like Ben Arc (LNbits creator) and fiatjaf (Nostr protocol founder, LNURL creator, GRASP protocol developer)."**

**"gittr.space repositories announced via NIP-34 events (kind 30617), stored on GRASP-compatible git servers (fiatjaf's protocol). Architecture ensures no single point of failure—repos replicated across Nostr relay network automatically. Fulfills 2022 Jack Dorsey bounty for GitHub replacement on Nostr, as highlighted by Derek Ross, prominent Nostr app founder."**

**"Unlike GitHub/GitLab, no central server that can go down or be censored. Unlike self-hosted Git servers, no infrastructure management—network handles redundancy. Unlike other Nostr Git clients (gitworkshop.dev, ngit), which are CLI-focused with limited authentication, gittr provides full-featured web platform with proper key management, multi-source file fetching, collaboration tools."**

**"Platform combines GitHub, GitLab, Codeberg, Nostr cloud into unified experience. Standard Git operations via SSH/HTTPS through git-nostr-bridge (self-hostable). Bitcoin Lightning integrated via LNURL (fiatjaf) and LNbits (Ben Arc) for zaps and bounties. Addresses critical need: open source developers need sustainable income. Zaps enable direct support; bounties create job market—developers fund features they need or work on bounties from others."**

**"Currently maintained by two core developers. Open source—not traditional company seeking VC, but part of Nostr ecosystem. Funding enables team growth, infrastructure scaling, feature development (marketplace for paid repos/packages), security audits, community support."**

**"Future includes marketplace where developers sell software packages and premium repositories directly via Lightning payments. As Nostr ecosystem grows, positioned to be Git layer of that network."**

---

## Key Technical Points

### Protocol Compliance
- **NIP-34**: Repository announcements and state events
- **NIP-07**: Browser extension authentication
- **NIP-46**: Remote signer support
- **NIP-25**: Reactions for starring repos
- **NIP-51**: Lists for following repos
- **NIP-C0**: Code snippet sharing (kind 1337)
- **GRASP**: Git server protocol for Nostr

### Architecture Decisions
- **Bare Git repositories**: Standard Git format, compatible with all Git clients
- **Nostr events for metadata**: Repository info, issues, PRs stored as Nostr events
- **Multi-source file fetching**: Automatic fallback chain for reliability
- **Self-hostable bridge**: Go-based service, can run your own instance
- **Web UI + CLI**: Full-featured platform, not just CLI tools

### Security & Privacy
- **Local storage**: All data stored in browser (repos, keys, settings)
- **Encrypted keys**: Optional password protection for private keys
- **No server-side storage**: User data never leaves device unless explicitly pushed
- **SSH key management**: Keys published as Nostr events (kind 52), bridge updates authorized_keys

---

## Social Media Version (Technical)

**"gittr.space: Decentralized Git hosting on Nostr**

✅ NIP-34 compliant (kind 30617/30618)  
✅ GRASP protocol—interoperable git servers  
✅ Multi-source file fetching (GitHub/GitLab/Codeberg/Nostr)  
✅ Full-featured web platform (not just CLI)  
✅ Bitcoin Lightning integration  
✅ Self-hostable (open source)  

Built for developers who want true ownership. 👉 gittr.space"

---

## One-Liner Options (Technical)

- "Decentralized Git hosting on Nostr—NIP-34 compliant, GRASP protocol, self-hostable."
- "Git repositories on Nostr relay network—no single point of failure, censorship-resistant."
- "NIP-34 Git hosting with full-featured web UI—combines GitHub, GitLab, Codeberg, Nostr cloud."
- "Self-sovereign Git hosting: NIP-34 events + GRASP servers + Lightning payments."
