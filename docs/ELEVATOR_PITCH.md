# gittr.space - Technical Overview & Positioning

## Core Value Proposition

**gittr.space is a decentralized Git hosting platform built on Nostr (NIP-34). Repositories are announced via Nostr events and stored on GRASP-compatible git servers, with automatic replication across the relay network.**

Unlike centralized platforms, there's no single point of failure. Repositories persist across thousands of Nostr relays, making them resilient to outages, censorship, and takedowns.

## Technical Architecture

### Protocol & Standards
- **NIP-34 compliant**: Repository announcements (kind 30617) and state events (kind 30618)
- **GRASP protocol**: Interoperable with other Nostr-based git servers (relay.ngit.dev, gitnostr.com, etc.)
- **Standard Git operations**: SSH and HTTPS support via git-nostr-bridge
- **Nostr relay network**: Repositories replicated across multiple relays automatically

### Implementation
- **Frontend**: Next.js web application with full-featured UI
- **Backend**: Go-based git-nostr-bridge service (self-hostable)
- **Storage**: Bare Git repositories on GRASP servers, metadata in Nostr events
- **Authentication**: NIP-07 browser extensions, NIP-46 remote signers, or stored keys
- **Payments**: Bitcoin Lightning integration (LNbits, LNURL, NWC) for zaps and bounties

### Key Differentiators

**vs GitHub/GitLab/Codeberg:**
- Decentralized architecture—no single point of failure
- Censorship-resistant—repos exist across thousands of relays
- Self-sovereign—developers own their data completely
- Built-in Lightning payments—no separate payment infrastructure needed

**vs Self-Hosted Git Server:**
- No server management—network handles redundancy automatically
- Automatic backup across Nostr relay network
- Built-in discoverability—repos are part of a global network
- Lightning payments integrated—no need to set up payment infrastructure
- **But you CAN self-host**: The code is open source; deploy your own bridge/relay if desired

**vs Other Nostr Git Clients** (e.g., gitworkshop.dev, ngit):
- **Full-featured web platform** vs CLI-focused tools
- **Proper authentication** vs limited or no key management
- **Multi-source integration**—combines GitHub, GitLab, Codeberg, and Nostr cloud into one unified experience
- **Collaboration tools**—web UI with issue tracking, PRs, bounties, and code snippets
- **Unified experience**—all sources accessible through one interface

## Current State

**Team**: Two core developers maintaining the platform

**Status**: Fully functional with active users. Core features implemented:
- Repository creation, import, and management
- Git operations (clone, push, pull) via SSH and HTTPS
- Issue tracking and pull requests
- Bitcoin Lightning bounties
- Code snippet sharing (NIP-C0)
- Multi-source file fetching (GitHub, GitLab, Codeberg, GRASP servers)

**Open Source**: All code is open source. Not a traditional company seeking VC funding—part of the Nostr ecosystem.

## Funding Needs

**What funding would enable:**

1. **Team Growth**: Hire additional developers to accelerate feature development and maintain infrastructure
2. **Infrastructure Scaling**: Support more GRASP servers and relays as userbase grows
3. **Feature Development**: Build out marketplace for paid repos/packages, advanced collaboration tools
4. **Security**: Professional security audits and penetration testing
5. **Documentation**: Comprehensive guides, tutorials, developer resources
6. **Community**: Fund events, hackathons, developer outreach
7. **Reliability**: Ensure critical infrastructure (bridges, relays) has redundancy and monitoring
8. **Developer Tools**: CLI tools, IDE plugins, integrations with other platforms

## Technical Advantages

### Decentralization
- Repositories announced via Nostr events (kind 30617)
- State tracked via replaceable events (kind 30618)
- Files stored on GRASP-compatible git servers
- Automatic replication across relay network
- No single point of failure

### Self-Hostability
- git-nostr-bridge is self-hostable (Go-based)
- Can deploy your own relay or use existing ones
- Code is open source—no vendor lock-in
- Push to Nostr, self-host, or both

### Multi-Source Architecture
- Automatically fetches files from multiple sources:
  - GitHub/GitLab/Codeberg APIs (for imported repos)
  - GRASP servers (relay.ngit.dev, gitnostr.com, etc.)
  - Nostr events (embedded files in legacy repos)
- Fallback chain ensures files are always accessible

### Authentication & Security
- NIP-07 browser extensions (Flamingo, nos2x-fox, Alby)
- NIP-46 remote signers (LNbits, Nowser, Bunker)
- Encrypted key storage (optional password protection)
- SSH key management via Nostr events (kind 52)

## Future Roadmap

**Marketplace**: Paid repositories and software packages with Bitcoin Lightning payments
- Direct peer-to-peer payments—no platform fees
- LNURL-withdraw links for bounties (already implemented)
- Future: Paid private repos, installable packages

**Network Growth**: Participate in GRASP network expansion
- More GRASP servers = more redundancy
- Growing Nostr ecosystem = larger userbase
- Interoperability with other Nostr Git clients

## 30-Second Technical Summary

**"gittr.space is decentralized Git hosting on Nostr. Repositories are announced via NIP-34 events and stored on GRASP-compatible git servers. Unlike centralized platforms, there's no single point of failure—repos persist across thousands of Nostr relays. Unlike CLI-focused Nostr Git clients, gittr provides a full-featured web platform with proper authentication, multi-source integration, and collaboration tools. The code is open source and self-hostable. Currently maintained by two developers; seeking support to grow the team, scale infrastructure, and accelerate development."**

## 60-Second Technical Summary

**"gittr.space implements decentralized Git hosting using Nostr (NIP-34). Repositories are announced via kind 30617 events and stored on GRASP-compatible git servers. The architecture ensures no single point of failure—repos are replicated across the Nostr relay network automatically."**

**"Unlike GitHub or GitLab, there's no central server that can go down or be censored. Unlike self-hosted Git servers, you don't manage infrastructure—the network handles redundancy. Unlike other Nostr Git clients like gitworkshop.dev or ngit, which are CLI-focused with limited authentication, gittr provides a full-featured web platform with proper key management, multi-source file fetching, and collaboration tools."**

**"The platform combines GitHub, GitLab, Codeberg, and the Nostr cloud into one unified experience. Standard Git operations work via SSH and HTTPS through the git-nostr-bridge service, which is self-hostable. Bitcoin Lightning is integrated for zaps and bounties."**

**"Currently maintained by two core developers. The code is open source—not a traditional company seeking VC funding, but part of the Nostr ecosystem. Funding would enable team growth, infrastructure scaling, feature development (marketplace for paid repos/packages), security audits, and community support."**

**"The future includes a marketplace where developers can sell software packages and premium repositories directly via Lightning payments. As the Nostr ecosystem grows, we're positioned to be the Git layer of that network."**

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
- "Git repositories on the Nostr relay network—no single point of failure, censorship-resistant."
- "NIP-34 Git hosting with full-featured web UI—combines GitHub, GitLab, Codeberg, and Nostr cloud."
- "Self-sovereign Git hosting: NIP-34 events + GRASP servers + Lightning payments."
