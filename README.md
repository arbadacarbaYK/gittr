# gittr.space - Git over Nostr with Bitcoin Incentives

A decentralized Git platform built on Nostr with native Bitcoin/Lightning payment integration. Think GitHub, but censorship-resistant, with zaps, bounties, and decentralized storage.

**Platform**: [gittr.space](https://gittr.space)

## 🚀 Features

### Core Repository Management
- ✅ Create, import, fork, and manage repositories
- ✅ Full file tree navigation with branch/tag switching
- ✅ File viewing, editing, and deletion
- ✅ GitHub and GitLab import (single repo and bulk)
- ✅ Commit history, git blame, and diff views
- ✅ Releases and tags management
- ✅ File source indicators (shows where files come from: embedded, git-nostr-bridge, GitHub, GitLab)

### Collaboration
- ✅ Issues with bounties and assignees
- ✅ Pull requests with review system
- ✅ Projects (Kanban board and roadmap views)
- ✅ Discussions (basic implementation)
- ✅ Contributor tracking with GitHub profile linking
- ✅ Notifications (Nostr DM, Telegram DM, channel announcements)

### Payments & Incentives
- ✅ Zap repositories (split to contributors)
- ✅ Issue bounties (funded via LNbits)
- ✅ Accumulated zap distribution (manual split)
- ✅ Payment settings (LNURL, LUD-16, NWC, LNbits)
- ✅ Bounty Hunt page for discovering funded work

### Developer Experience
- ✅ Fuzzy file finder (Cmd/Ctrl+P)
- ✅ Repo-wide code search
- ✅ Copy permalink with deep linking
- ✅ URL parameters for branch/file/path
- ✅ Clone URLs (HTTPS/SSH) with SSH/Git help guide
- ✅ SSH key management (Settings → SSH Keys)
- ✅ Multiple themes (Classic, Cypherpunk, Girly, 80s Arcade)

### Discovery & Social
- ✅ Explore page (repos and users)
- ✅ User profiles with activity timelines
- ✅ Activity tracking and statistics
- ✅ Sponsors page (users who zapped you)
- ✅ Stars and zaps history

## 🛠️ Tech Stack

- **Frontend**: Next.js 13 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes, Fastify (planned)
- **Nostr**: `nostr-relaypool`, `nostr-tools`
- **Storage**: Browser localStorage (client-side) + NIP-96 Blossom (for Git pack files)
- **Payments**: LNbits, NWC (Nostr Wallet Connect), LNURL/LUD-16
- **Relays**: Default relays + user-configurable
- **Git Operations**: **Go-based git-nostr-bridge** (required for `git clone`/`push`/`pull`)
  - `git-nostr-bridge`: Service that watches Nostr and manages Git repos
  - `git-nostr-ssh`: SSH command handler for Git operations
  - `git-nostr-cli`: CLI tool for managing repos (optional)
  - Located in `ui/gitnostr/` - **All Go components are included!**

## 📊 Architecture & Data Storage

### NIP-34 Architecture (File Storage)

gittr.space follows the **NIP-34 architecture** for repository file storage:

- **Files are stored on git servers** (git-nostr-bridge, GitHub, GitLab, etc.)
- **Nostr events contain references** via `clone` URLs or `sourceUrl` tags
- **Only small metadata files** (like README) are embedded in Nostr events
- **Foreign repos** (imported from GitHub/GitLab) fetch files from their source servers
- **Local repos** can be pushed to git-nostr-bridge for decentralized hosting

**File Source Indicators:**
- 📦 **Embedded**: Files stored directly in Nostr event (legacy)
- ⚡ **git-nostr-bridge**: Files stored on decentralized git server
- 🐙 **GitHub**: Files fetched from GitHub API
- 🦊 **GitLab**: Files fetched from GitLab API

The file source is displayed in the repository's "About" sidebar, making it clear where files are stored.

### File Fetching Flows

gittr.space uses a sophisticated multi-source file fetching system that tries multiple strategies in parallel to ensure fast and reliable file access. The system is designed to work with various git server types (GRASP servers, GitHub, GitLab, Codeberg) and handles both embedded files and files stored on remote servers.

#### File List Fetching Flow (Opening a Repository)

When a user opens a repository page, the system fetches the complete file tree using this flow:

```mermaid
flowchart TD
    Start([User Opens Repo Page<br/>Input: entity, repo, branch]) --> CheckCache{Check localStorage<br/>Input: entity, repo<br/>Output: cached files or null}
    
    CheckCache -->|Files Found| CacheMatch{Entity + Repo Match?}
    CacheMatch -->|Yes| UseCache[✅ Use Cached Files<br/>Output: files array<br/>Return: Display files]
    CacheMatch -->|No| CheckEmbedded
    
    CheckCache -->|No Cache| CheckEmbedded{Check Embedded Files<br/>Input: repoData.files<br/>Output: files array or null}
    
    CheckEmbedded -->|Files Found| UseEmbedded[✅ Use Embedded Files<br/>Output: files array<br/>Return: Display files]
    CheckEmbedded -->|No Files| ResolveOwnerPubkey[Resolve ownerPubkey<br/>Input: params.entity npub<br/>Process: nip19.decode<br/>Output: 64-char hex pubkey]
    
    ResolveOwnerPubkey --> TryBridge{Try git-nostr-bridge API<br/>Input: ownerPubkey, repo, branch<br/>GET /api/nostr/repo/files<br/>Output: files array or 404}
    
    TryBridge -->|200 OK| BridgeSuccess[✅ Files from Bridge<br/>Output: files array<br/>Return: Display files]
    TryBridge -->|404 Not Found| CheckGrasp{Is GRASP Server?<br/>Input: clone URLs<br/>Check: knownGraspServers list}
    
    CheckGrasp -->|Yes| TriggerClone[Trigger Clone<br/>Input: cloneUrl, ownerPubkey, repo<br/>POST /api/nostr/repo/clone<br/>Output: clone started]
    
    TriggerClone --> WaitClone[Wait 3 seconds<br/>Process: setTimeout<br/>Output: time elapsed]
    
    WaitClone --> RetryBridge{Retry Bridge API<br/>Input: ownerPubkey, repo, branch<br/>GET /api/nostr/repo/files<br/>Output: files array or 404}
    
    RetryBridge -->|200 OK| BridgeSuccess
    RetryBridge -->|404| MultiSource
    
    CheckGrasp -->|No| MultiSource[Multi-Source Fetch<br/>Input: cloneUrls array, branch<br/>Process: fetchFilesFromMultipleSources<br/>Uses Promise.race for first success]
    
    MultiSource --> ParseSources[Parse Git Sources<br/>Input: cloneUrls<br/>Process: parseGitSource for each URL<br/>Output: GitSource objects]
    
    ParseSources --> ParallelFetch[Parallel Fetch All Sources<br/>Input: GitSource array<br/>Process: Promise.race<br/>Output: First success or all failed]
    
    ParallelFetch --> GitHub{Try GitHub<br/>Input: owner, repo, branch<br/>API: /repos/{owner}/{repo}/git/trees/{sha}<br/>Output: files array or error}
    
    ParallelFetch --> GitLab{Try GitLab<br/>Input: owner, repo, branch<br/>API: /api/v4/projects/{path}/repository/tree<br/>Output: files array or error}
    
    ParallelFetch --> Codeberg{Try Codeberg<br/>Input: owner, repo, branch<br/>API: /api/v1/repos/{owner}/{repo}/git/trees/{branch}<br/>Output: files array or error}
    
    ParallelFetch --> GraspServers{Try GRASP Servers<br/>Input: cloneUrl, npub, repo, branch<br/>Process: fetchFromNostrGit<br/>Output: files array or error}
    
    GitHub -->|Success| FirstSuccess[✅ First Success Found<br/>Output: files array<br/>Process: Update UI immediately<br/>Return: Display files]
    GitLab -->|Success| FirstSuccess
    Codeberg -->|Success| FirstSuccess
    GraspServers -->|Success| FirstSuccess
    
    GitHub -->|Error| ContinueBackground[Continue in Background<br/>Process: Update statuses<br/>Output: Final status for each source]
    GitLab -->|Error| ContinueBackground
    Codeberg -->|Error| ContinueBackground
    GraspServers -->|Error| ContinueBackground
    
    FirstSuccess --> UpdateState[Update State & localStorage<br/>Input: files array<br/>Process: setRepoData, localStorage.setItem<br/>Output: UI updated, data persisted]
    
    UpdateState --> End([✅ Files Displayed<br/>Output: File tree visible to user])
    
    ContinueBackground --> UpdateStatuses[Update Source Statuses<br/>Input: status for each source<br/>Output: Status display updated<br/>Shows: ✓ Fetched or ✗ No files found]
    
    style Start fill:#e1f5ff
    style UseCache fill:#c8e6c9
    style UseEmbedded fill:#c8e6c9
    style BridgeSuccess fill:#c8e6c9
    style FirstSuccess fill:#c8e6c9
    style End fill:#c8e6c9
    style TriggerClone fill:#fff9c4
    style WaitClone fill:#fff9c4
```

#### File Opening Flow (Clicking a File)

When a user clicks on a file to view its content, the system uses this flow:

```mermaid
flowchart TD
    Start([User Clicks File<br/>Input: filePath, branch]) --> CheckOverrides{Check Overrides<br/>Input: localStorage gittr_overrides<br/>Output: override content or null}
    
    CheckOverrides -->|Override Found| UseOverride[✅ Use Override Content<br/>Output: fileContent string<br/>Return: Display file]
    CheckOverrides -->|No Override| Strategy1[Strategy 1: Check Embedded Files<br/>Input: repoData.files array, filePath<br/>Process: find matching fileEntry<br/>Output: fileEntry with content or null]
    
    Strategy1 -->|File Found| CheckContentFields{Check Content Fields<br/>Input: fileEntry<br/>Check: content, data, body, text, fileContent<br/>Output: foundContent string or null}
    
    CheckContentFields -->|Content Found| CheckBinary{Is Binary?<br/>Input: fileEntry.isBinary, file extension<br/>Output: isBinary boolean}
    
    CheckBinary -->|Yes| CreateDataURL[Create Data URL<br/>Input: base64 content, mimeType<br/>Process: data:{mimeType};base64,{content}<br/>Output: dataUrl string]
    CreateDataURL --> ReturnEmbedded[✅ Return Embedded Content<br/>Output: {content: null, url: dataUrl, isBinary: true}<br/>Return: Display file]
    
    CheckBinary -->|No| ReturnText[✅ Return Text Content<br/>Output: {content: foundContent, url: null, isBinary: false}<br/>Return: Display file]
    
    CheckContentFields -->|No Content| Strategy2
    Strategy1 -->|File Not Found| Strategy2[Strategy 2: git-nostr-bridge API<br/>Input: filePath, branch]
    
    Strategy2 --> ResolveOwnerPubkey[Resolve ownerPubkey<br/>Priority 1: repoData.ownerPubkey<br/>Priority 2: localStorage matching repo<br/>Priority 3: Decode npub from params.entity<br/>Priority 4: resolveEntityToPubkey utility<br/>Output: 64-char hex pubkey]
    
    ResolveOwnerPubkey --> CallBridgeAPI{Call Bridge API<br/>Input: ownerPubkey, repo, path, branch<br/>GET /api/nostr/repo/file-content<br/>Output: 200 OK with content or 404}
    
    CallBridgeAPI -->|200 OK| CheckResponseBinary{Is Binary Response?<br/>Input: response.isBinary<br/>Output: boolean}
    
    CheckResponseBinary -->|Yes| CreateBridgeDataURL[Create Data URL<br/>Input: base64 content from API<br/>Output: dataUrl string]
    CreateBridgeDataURL --> ReturnBridgeBinary[✅ Return Bridge Binary<br/>Output: {content: null, url: dataUrl, isBinary: true}<br/>Return: Display file]
    
    CheckResponseBinary -->|No| ReturnBridgeText[✅ Return Bridge Text<br/>Output: {content: textContent, url: null, isBinary: false}<br/>Return: Display file]
    
    CallBridgeAPI -->|404 Not Found| CheckGrasp{Is GRASP Server?<br/>Input: cloneUrls, knownGraspServers<br/>Output: boolean}
    
    CheckGrasp -->|Yes| TriggerClone[Trigger Clone<br/>Input: cloneUrl, ownerPubkey, repo<br/>POST /api/nostr/repo/clone<br/>Output: clone started]
    
    TriggerClone --> PollFile[Poll for File<br/>Input: apiUrl<br/>Process: Loop max 5 attempts, 1s delay<br/>GET /api/nostr/repo/file-content<br/>Output: 200 OK or timeout]
    
    PollFile -->|200 OK| CheckPollBinary{Is Binary?<br/>Input: response.isBinary<br/>Output: boolean}
    
    CheckPollBinary -->|Yes| CreatePollDataURL[Create Data URL<br/>Output: dataUrl string]
    CreatePollDataURL --> ReturnPollBinary[✅ Return Polled Binary<br/>Output: {content: null, url: dataUrl, isBinary: true}<br/>Return: Display file]
    
    CheckPollBinary -->|No| ReturnPollText[✅ Return Polled Text<br/>Output: {content: textContent, url: null, isBinary: false}<br/>Return: Display file]
    
    PollFile -->|Timeout| Strategy3
    CheckGrasp -->|No| Strategy3[Strategy 3: External Git Servers<br/>Input: sourceUrl, filePath, branch]
    
    Strategy3 --> ResolveSourceUrl[Resolve sourceUrl<br/>Priority 1: repoData.sourceUrl<br/>Priority 2: repoData.forkedFrom<br/>Priority 3: clone URLs from repoData<br/>Priority 4: localStorage matching repo<br/>Output: sourceUrl string]
    
    ResolveSourceUrl --> ParseSource{Parse Source Type<br/>Input: sourceUrl<br/>Process: Match regex patterns<br/>Output: githubMatch, gitlabMatch, codebergMatch}
    
    ParseSource -->|GitHub| CallGitHubAPI{Call GitHub API Proxy<br/>Input: sourceUrl, path, branch<br/>GET /api/git/file-content<br/>Backend: raw.githubusercontent.com<br/>Output: 200 OK with content or error}
    
    ParseSource -->|GitLab| CallGitLabAPI{Call GitLab API Proxy<br/>Input: sourceUrl, path, branch<br/>GET /api/git/file-content<br/>Backend: GitLab API<br/>Output: 200 OK with content or error}
    
    ParseSource -->|Codeberg| CallCodebergAPI{Call Codeberg API Proxy<br/>Input: sourceUrl, path, branch<br/>GET /api/git/file-content<br/>Backend: Codeberg API<br/>Output: 200 OK with content or error}
    
    CallGitHubAPI -->|200 OK| CheckAPIBinary{Is Binary?<br/>Input: response.isBinary<br/>Output: boolean}
    CallGitLabAPI -->|200 OK| CheckAPIBinary
    CallCodebergAPI -->|200 OK| CheckAPIBinary
    
    CheckAPIBinary -->|Yes| CreateAPIDataURL[Create Data URL<br/>Input: base64 content<br/>Output: dataUrl string]
    CreateAPIDataURL --> ReturnAPIBinary[✅ Return API Binary<br/>Output: {content: null, url: dataUrl, isBinary: true}<br/>Return: Display file]
    
    CheckAPIBinary -->|No| ReturnAPIText[✅ Return API Text<br/>Output: {content: textContent, url: null, isBinary: false}<br/>Return: Display file]
    
    CallGitHubAPI -->|Error| TryNextBranch{Try Next Branch<br/>Input: branchesToTry array<br/>Process: Try main, master<br/>Output: success or all failed}
    CallGitLabAPI -->|Error| TryNextBranch
    CallCodebergAPI -->|Error| TryNextBranch
    
    TryNextBranch -->|Success| CheckAPIBinary
    TryNextBranch -->|All Failed| ErrorState[❌ Unable to Load File<br/>Output: {content: null, url: null, isBinary: false}<br/>Return: Show error message]
    
    ReturnEmbedded --> RenderFile[Render File Content<br/>Input: content or url, isBinary<br/>Process: CodeViewer, iframe, img, video, etc.<br/>Output: File displayed to user]
    ReturnText --> RenderFile
    ReturnBridgeBinary --> RenderFile
    ReturnBridgeText --> RenderFile
    ReturnPollBinary --> RenderFile
    ReturnPollText --> RenderFile
    ReturnAPIBinary --> RenderFile
    ReturnAPIText --> RenderFile
    
    RenderFile --> End([✅ File Displayed<br/>Output: File content visible to user])
    
    ErrorState --> End
    
    style Start fill:#e1f5ff
    style UseOverride fill:#c8e6c9
    style ReturnEmbedded fill:#c8e6c9
    style ReturnText fill:#c8e6c9
    style ReturnBridgeBinary fill:#c8e6c9
    style ReturnBridgeText fill:#c8e6c9
    style ReturnPollBinary fill:#c8e6c9
    style ReturnPollText fill:#c8e6c9
    style ReturnAPIBinary fill:#c8e6c9
    style ReturnAPIText fill:#c8e6c9
    style End fill:#c8e6c9
    style TriggerClone fill:#fff9c4
    style PollFile fill:#fff9c4
    style ErrorState fill:#ffcdd2
```

**Key Features of These Flows:**

1. **Multi-Source Parallel Fetching**: File list fetching uses `Promise.race` to return the first successful source immediately, while other sources continue in the background to update their statuses.

2. **Automatic Cloning**: GRASP repositories automatically trigger a clone when not found locally, then retry the API call.

3. **Robust Fallback Chain**: Both flows have multiple fallback strategies, ensuring files can be fetched even if one source fails.

4. **Binary File Handling**: Binary files are detected, encoded as base64, and converted to data URLs for display in the browser.

5. **OwnerPubkey Resolution**: The system uses multiple strategies to resolve the correct owner pubkey, ensuring consistency between file fetching and file opening.

## What's Stored WHERE

#### ✅ Client-Side (Browser localStorage) - **ALL User Data**
- **Nostr private keys** (encrypted with user password)
- **Payment credentials** (LNbits admin keys, LNURL, NWC - encrypted)
- **Repositories** (metadata, files, readme)
- **Issues & PRs** (all user data)
- **User settings** (preferences, themes)

**✅ All personal data stays on YOUR device - never on the server!**

#### ✅ Server-Side (Next.js API) - **ONLY for processing**
- **Payment processing** (creates invoices, sends zaps) - **NEVER stores user creds**
- **GitHub OAuth** (temporary token exchange)
- **No database** - no user data stored on server
- **API routes** - can be called from local frontend or hosted frontend

### Deployment Options

**Option 1: Hosted (Recommended)**
- Frontend + API run on your server
- Users access via `https://gittr.space`
- All data still stored in browser localStorage

**Option 2: Standalone Frontend**
- Users run frontend locally (PWA/Electron)
- Connects to your server's API via CORS
- All data still stored locally (browser localStorage)
- Configure `NEXT_PUBLIC_API_URL` to point to your server

**✅ Security**: Your credentials NEVER leave your device, regardless of deployment option!

## 🔐 Authentication

gittr.space supports multiple authentication methods:

- **NIP-07**: Browser extension (e.g., Alby, Nos2x)
- **Private Key (nsec)**: Direct private key login
- **NIP-05**: Email-based verification

## 💰 Payment Configuration

### Receiving Payments
Configure in Settings → Account:
- **LNURL**: For LNURL-pay invoices
- **Lightning Address (LUD-16)**: Lightning address format
- **NWC Receive**: Nostr Wallet Connect for receiving

### Sending Payments
- **NWC Send**: Configure Nostr Wallet Connect string for client-side payments
- **LNbits**: Server-side payments (requires LNbits instance)

### Testing Payments
Use small amounts (2-10 sats) during development. Test wallets:
- LNbits: ~300 sats
- NWC: ~84 sats

## 📚 Setup & Documentation

- **[SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md)** - Complete production setup guide
- **[LOCAL_SETUP.md](LOCAL_SETUP.md)** - Local development setup
- **[Concept Document](docs/CONCEPT.md)** - Complete feature specification
- **[Grasp Relay Setup](docs/GRASP_RELAY_SETUP.md)** - How to set up your own relay instance (Grasp protocol)
- **[Testing Guide](MANUAL_TESTING_GUIDE.md)** - Manual testing procedures
- **[Testing Status](TESTING_STATUS.md)** - Current testing status
- **[Open Issues](OPEN_ISSUES.md)** - Known issues and missing features

## 🎨 Themes

gittr.space supports multiple themes:
- **Classic**: Default dark theme with violet accents
- **Cypherpunk**: Neon green on black (terminal aesthetic)
- **Girly**: Pink pastels on dark purple
- **80s Arcade**: Neon cyan/magenta with retro vibes

Change theme in Settings → Appearance.

## 🧪 Testing

See `MANUAL_TESTING_GUIDE.md` for comprehensive test procedures.

### Quick Test Checklist
- [ ] Create repository
- [ ] Import from GitHub
- [ ] Create issue with bounty
- [ ] Create and merge PR
- [ ] Configure payments and test zap
- [ ] Test theme switching
- [ ] Verify search functionality

## 🐛 Known Issues

See `OPEN_ISSUES.md` for complete list of known issues and missing features.

### Current Known Issues
- Relay status indicators may show disconnected initially (my-relays page)
- Some GitHub-imported repos may not show contributor icons

## 🚧 Roadmap

### High Priority
- Enhanced branch/tag switcher UI
- PR conflict detection
- Commit graph visualization
- Better code search ranking

### Medium Priority
- Keyboard shortcuts overlay
- Line range permalinks
- CI/checks status surface
- VS Code protocol links

### Future
- MCP server integration
- SSH key management
- Security hardening for production

## 🤝 Contributing

This project is in active development. Contributions welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

The `gitnostr` Go components (`ui/gitnostr/`) are licensed under the **MIT License** (see `ui/gitnostr/LICENSE.md` for details).

See `ui/LICENSE` for the full AGPL-3.0 license text.

## 🙏 Acknowledgments

- Built on [NostrGit](https://github.com/NostrGit/NostrGit) UI (forked from original)
- Uses [nostr-relaypool](https://github.com/adamritter/nostr-relaypool) for relay management
- Uses [gitnostr](https://github.com/spearson78/gitnostr) Go components for Git operations
- Implements [GRASP Protocol](https://ngit.dev/grasp/) for distributed Git hosting (newer than original NostrGit)
- Inspired by GitHub's developer experience

**Note:** This project (`gittr.space`) is a fork of NostrGit that has been significantly developed and diverged from the original. It is a separate project and platform, not to be confused with other legacy NGIT forks. Key additions include:
- ✅ GRASP protocol support (clone/relays tags, client-side proactive sync)
- ✅ Bitcoin/Lightning payment integration (zaps, bounties)
- ✅ Enhanced UI features (themes, activity tracking, explore page)
- ✅ Notification system (Nostr DM, Telegram DM, channel announcements)
- ✅ All original Go components (`git-nostr-bridge`, `git-nostr-cli`, `git-nostr-ssh`) are included and functional

## 📞 Support

- Issues: [GitHub Issues](https://github.com/arbadacarbaYK/ngit/issues) (repo currently hosted under the legacy `ngit` name)
- Discussions: [GitHub Discussions](https://github.com/arbadacarbaYK/ngit/discussions)

---

**Status**: Production-ready. Actively maintained.

## System Nostr Account for Sharing

To enable sharing repositories to Nostr without requiring users to log in, configure a system Nostr account:

1. Generate a keypair:
   ```bash
   cd ui
   npm run generate-system-keypair
   ```

2. Add the generated keys to your `.env.local`:
   ```bash
   NEXT_PUBLIC_SYSTEM_NSEC=nsec1your_generated_nsec_here
   NEXT_PUBLIC_SYSTEM_NPUB=npub1your_generated_npub_here
   ```

3. **Important**: Never commit the NSEC to git! Keep it secure.

The system account will be used to sign and publish share notes when users click "Share to Nostr" without logging in.
