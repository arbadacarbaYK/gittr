"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { BookOpen, Code, GitBranch, Zap, Coins, Settings, Shield, Bell, Github, HelpCircle } from "lucide-react";

export default function HelpPage() {
  const mermaidRef = useRef<HTMLDivElement>(null);

  // Render Mermaid diagram
  useEffect(() => {
    if (!mermaidRef.current || typeof window === "undefined") return;

    let isMounted = true;

    // Dynamically import Mermaid (client-side only)
    import("mermaid").then((mermaidModule) => {
      if (!isMounted || !mermaidRef.current) return;
      
      const mermaid = mermaidModule.default;
      
      // Initialize Mermaid with theme settings (only once)
      if (!(window as any).__mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: true,
          theme: "dark",
          themeVariables: {
            primaryColor: "#8b5cf6",
            primaryTextColor: "#fff",
            primaryBorderColor: "#7c3aed",
            primaryBorderWidth: "2px",
            lineColor: "#64748b",
            secondaryColor: "#1e293b",
            tertiaryColor: "#0f172a",
            background: "#0f172a",
            mainBkg: "#1e293b",
            secondBkg: "#22262C",
            tertiaryBkg: "#0f172a",
            textColor: "#fff",
            clusterBkg: "#1e293b",
            clusterBorder: "#7c3aed",
            defaultLinkColor: "#64748b",
            titleColor: "#fff",
            edgeLabelBackground: "#1e293b",
            nodeBkg: "#1e293b",
            nodeBorder: "#7c3aed",
            nodeTextColor: "#fff",
          },
          securityLevel: "loose",
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: "basis",
            padding: 30,
            nodeSpacing: 80,
            rankSpacing: 100,
          },
        });
        (window as any).__mermaidInitialized = true;
      }

      if (!mermaidRef.current) return;

      // Clear previous content
      mermaidRef.current.innerHTML = "";

      // Create a unique ID for this diagram
      const diagramId = `bounty-flow-${Date.now()}`;
      
      // Create element with mermaid class and diagram content
      const mermaidDiv = document.createElement("div");
      mermaidDiv.id = diagramId;
      mermaidDiv.className = "mermaid";
      mermaidDiv.textContent = `graph LR
    A["Bounty Creator<br/>Creates Bounty"] -->|"Checks LNbits Config"| B{"LNbits<br/>Configured?"}
    B -->|"No"| C["Prompt to Setup<br/>Settings → Account"]
    B -->|"Yes"| D["Create Withdraw Link<br/>from LNbits Wallet"]
    D -->|"Funds Reserved<br/>(Not Deducted)"| E["Withdraw Link Created<br/>Status: Paid"]
    E --> F["Developer Creates PR<br/>Links to Issue"]
    F --> G["Repo Owner<br/>Reviews PR"]
    G -->|"Approves & Merges"| H["Withdraw Link Released<br/>to PR Author"]
    H --> I["PR Author Claims<br/>Withdraw Link"]
    I -->|"Funds Deducted<br/>from Creator's Wallet"| J["Bounty Paid<br/>Status: Released"]
    
    style A fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style D fill:#f59e0b,stroke:#d97706,color:#fff
    style E fill:#10b981,stroke:#059669,color:#fff
    style H fill:#3b82f6,stroke:#2563eb,color:#fff
    style J fill:#10b981,stroke:#059669,color:#fff
    style C fill:#ef4444,stroke:#dc2626,color:#fff`;

      mermaidRef.current.appendChild(mermaidDiv);

      // Render the diagram
      mermaid.run({
        nodes: [mermaidDiv],
      });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <HelpCircle className="h-8 w-8 text-purple-400" />
          Help & Documentation
        </h1>
        <p className="text-gray-400">
          Everything you need to know about using gittr.space - Git over Nostr with Bitcoin incentives
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {/* Quick Links */}
        <div className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-purple-400" />
            Quick Start
          </h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>• <Link href="#getting-started" className="text-purple-400 hover:text-purple-300">Getting Started</Link></li>
            <li>• <Link href="#repositories" className="text-purple-400 hover:text-purple-300">Managing Repositories</Link></li>
            <li>• <Link href="#payments" className="text-purple-400 hover:text-purple-300">Payments & Bounties</Link></li>
            <li>• <Link href="#notifications" className="text-purple-400 hover:text-purple-300">Notifications</Link></li>
          </ul>
        </div>

        <div className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Code className="h-5 w-5 text-green-400" />
            Development
          </h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>• <Link href="#git-operations" className="text-green-400 hover:text-green-300">Git Operations</Link></li>
            <li>• <Link href="#ssh-keys" className="text-green-400 hover:text-green-300">SSH Keys</Link></li>
            <li>• <Link href="#collaboration" className="text-green-400 hover:text-green-300">Collaboration</Link></li>
          </ul>
        </div>

        <div className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Settings className="h-5 w-5 text-cyan-400" />
            Settings
          </h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>• <Link href="/settings" className="text-cyan-400 hover:text-cyan-300">Account Settings</Link></li>
            <li>• <Link href="/settings/notifications" className="text-cyan-400 hover:text-cyan-300">Notifications</Link></li>
            <li>• <Link href="/settings/payments" className="text-cyan-400 hover:text-cyan-300">Payment Methods</Link></li>
          </ul>
        </div>
      </div>

      <div className="space-y-8">
        {/* Getting Started */}
        <section id="getting-started" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4">Getting Started</h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">1. Login with NIP-07</h3>
              <p>
                Install a NIP-07 browser extension (like Alby, nos2x, or Flamingo) on desktop browsers.
                On mobile, extensions aren&apos;t supported, so use a signer app such as{" "}
                <a
                  href="https://github.com/haorendashu/nowser"
                  className="text-purple-400 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Nowser
                </a>
                .
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">2. Create or Import a Repository</h3>
              <p>Click "Create repository" to start a new repo, or "Import" to bring in an existing GitHub repository.</p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">3. Set Up Payments (Optional)</h3>
              <p>Go to Settings → Payments to configure LNbits, LNURL, or NWC for receiving zaps and bounties.</p>
            </div>
          </div>
        </section>

        {/* Repositories */}
        <section id="repositories" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-purple-400" />
            Managing Repositories
          </h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Creating Repositories</h3>
              <p>Create new repositories from scratch or import from GitHub. All repos are stored locally in your browser and can be pushed to Nostr for public access.</p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Repository Status</h3>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li><span className="text-yellow-400">Local</span> - Only exists on your device</li>
                <li><span className="text-blue-400">Pushing...</span> - Currently being published to Nostr</li>
                <li><span className="text-green-400">Live on Nostr</span> - Published to Nostr relays and processed by bridge</li>
                <li><span className="text-orange-400">Published (Verifying...)</span> - Published to Nostr and sent to bridge, verifying bridge processed it</li>
                <li><span className="text-red-400">Push Failed</span> - Publication attempt failed</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">File Management</h3>
              <p>View, edit, and delete files directly in the browser. Use the fuzzy file finder (Cmd/Ctrl+P) to quickly navigate large repositories.</p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">File Sources & NIP-34 Architecture</h3>
              <p>gittr.space follows the NIP-34 architecture for file storage. Files are stored on git servers, not in Nostr events. The repository's "About" sidebar shows where files come from:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li><span className="text-gray-400">📦 Embedded</span> - Files stored directly in Nostr event (legacy repos)</li>
                <li><span className="text-gray-400">⚡ git-nostr-bridge</span> - Files stored on decentralized git server</li>
                <li><span className="text-gray-400">🐙 GitHub</span> - Files fetched from GitHub API</li>
                <li><span className="text-gray-400">🦊 GitLab</span> - Files fetched from GitLab API</li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">This architecture ensures files are stored efficiently and can be fetched from multiple sources for redundancy.</p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Importing Repositories</h3>
              <p>You can import repositories from:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li><strong>GitHub</strong> - Single repo or bulk import via OAuth</li>
                <li><strong>GitLab</strong> - Import from GitLab URLs (coming soon)</li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">Imported repos maintain a link to their source (sourceUrl) and fetch files from the original git server.</p>
              <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm text-blue-200 font-semibold mb-1">💡 Large Repository Support</p>
                <p className="text-sm text-blue-100">
                  The import process now handles large repositories efficiently. Only file metadata (paths, sizes) is included in the import response, and file content is fetched on-demand when you view or edit files. This allows importing repositories of any size without hitting API response limits.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Git Operations */}
        <section id="git-operations" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Code className="h-6 w-6 text-green-400" />
            Git Operations
          </h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Clone a Repository</h3>
              <p>gittr.space repositories support multiple clone URL formats:</p>
              
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-green-400 mb-1">Option A: SSH (Standard Git - Recommended)</p>
                  <code className="block bg-[#0a0d11] p-2 rounded text-sm">
                git clone git@gittr.space:npub1.../repo-name.git
              </code>
                  <p className="mt-1 text-xs text-gray-400">Requires SSH keys (Settings → SSH Keys). Works out of the box with any Git client.</p>
                </div>
                
                <div>
                  <p className="text-sm font-semibold text-blue-300 mb-1">Option B: HTTPS (GRASP git servers)</p>
                  <code className="block bg-[#0a0d11] p-2 rounded text-sm">
                    git clone https://relay.ngit.dev/&lt;owner-pubkey&gt;/repo-name.git
                  </code>
                  <p className="mt-1 text-xs text-gray-400">Read-only clones from our public mirrors (relay.ngit.dev, gitnostr.com, ngit-relay.nostrver.se, ...). Great for CI/CD or quick testing.</p>
                </div>
                
                <div>
                  <p className="text-sm font-semibold text-purple-400 mb-1">Option C: nostr:// Protocol (Ecosystem Standard)</p>
                  <code className="block bg-[#0a0d11] p-2 rounded text-sm">
                    git clone nostr://npub1n2ph08n@relay.ngit.dev/tides
                  </code>
                  <p className="mt-1 text-xs text-gray-400">
                    Requires <code className="bg-gray-800 px-1 rounded">git-remote-nostr</code>. This helper translates <code className="bg-gray-800 px-1 rounded">nostr://</code> URLs into standard Git fetches and is used by other NIP-34 clients.
                  </p>
                  <div className="mt-2 text-[11px] text-gray-300 bg-[#0f172a] border border-purple-900/40 rounded p-2 space-y-1">
                    <p className="font-semibold text-purple-300">Install git-remote-nostr</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>macOS/Linux: <code className="bg-gray-900 px-1 rounded">pip install git-remote-nostr</code> (Python 3.10+)</li>
                      <li>or build from source: <a className="text-purple-300 underline" target="_blank" rel="noreferrer" href="https://github.com/aljazceru/git-remote-nostr">github.com/aljazceru/git-remote-nostr</a></li>
                      <li>Add to PATH so Git can find the helper (verify with <code className="bg-gray-900 px-1 rounded">which git-remote-nostr</code>)</li>
                    </ul>
                    <p>Once installed, <code className="bg-gray-900 px-1 rounded">git clone nostr://…</code> works exactly like GitHub URLs.</p>
                  </div>
                </div>
              </div>
              
              <p className="mt-3 text-sm text-gray-400">SSH, HTTPS, and nostr:// clone URLs all ship inside every NIP-34 repository event. Pick whichever matches your workflow.</p>
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="text-sm font-semibold text-white uppercase tracking-wide">Supported Git Commands</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-200">
                <div className="bg-[#11161f] border border-gray-700 rounded p-3 space-y-1">
                  <p className="font-semibold text-white">Day-to-day</p>
                  <code className="block bg-black/40 p-1 rounded">git pull / git fetch</code>
                  <code className="block bg-black/40 p-1 rounded">git checkout &lt;branch&gt;</code>
                  <code className="block bg-black/40 p-1 rounded">git status</code>
                  <code className="block bg-black/40 p-1 rounded">git add / git commit</code>
                </div>
                <div className="bg-[#11161f] border border-gray-700 rounded p-3 space-y-2">
                  <p className="font-semibold text-white">Publishing</p>
                  <p className="text-sm text-gray-200">
                    Use the <strong>Push to Nostr</strong> button in the repo UI. We publish the NIP‑34 event and automatically sync your repo to our git bridge so other clients can clone it immediately.
                  </p>
                  <p className="text-[11px] text-gray-400">
                    CLI fan? You can still run <code className="bg-black/40 px-1 rounded">git push origin main</code>; it hits the same bridge endpoint.
                  </p>
                </div>
                <div className="bg-[#11161f] border border-gray-700 rounded p-3 space-y-1">
                  <p className="font-semibold text-white">Branches & Tags</p>
                  <code className="block bg-black/40 p-1 rounded">git branch -a / git switch -c</code>
                  <code className="block bg-black/40 p-1 rounded">git tag v1.2.3</code>
                  <p className="text-[11px] text-gray-400">Releases and tags show up instantly in the UI.</p>
                </div>
                <div className="bg-[#11161f] border border-gray-700 rounded p-3 space-y-1">
                  <p className="font-semibold text-white">Troubleshooting</p>
                  <code className="block bg-black/40 p-1 rounded">git remote -v</code>
                  <code className="block bg-black/40 p-1 rounded">git config --list</code>
                  <code className="block bg-black/40 p-1 rounded">git log --oneline</code>
                </div>
              </div>
            </div>

            <div id="ssh-keys" className="mt-6 border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
              <h3 className="text-lg font-semibold text-white mb-2">SSH Keys vs NIP-34 (When to use which?)</h3>
              <p className="text-sm text-gray-300 mb-3">
                Most gittr actions happen via NIP‑34 events (signed with your Nostr key). You only need SSH keys when you want to talk to the git bridge directly (terminal/CI).
              </p>
              <ul className="list-disc list-inside space-y-1 text-xs text-gray-200">
                <li>
                  <strong>Web UI operations</strong> (Push to Nostr, PRs, Issues) publish <strong>NIP‑34 events</strong> through your Nostr key (NIP‑07 or locally stored <code className="bg-black/40 px-1 rounded">nsec</code>). No SSH key is required.
                </li>
                <li>
                  <strong>Command-line Git operations</strong> (<code className="bg-black/40 px-1 rounded">git clone</code>, <code className="bg-black/40 px-1 rounded">git push</code>, <code className="bg-black/40 px-1 rounded">git pull</code>) talk to <code className="bg-black/40 px-1 rounded">git.gittr.space</code> or other GRASP bridges and <strong>do require SSH keys</strong>.
                </li>
                <li>
                  SSH keys are <strong>only needed if you want terminal/CI access</strong>. Staying in the browser? You can skip them entirely.
                </li>
                <li>
                  Manage keys from <a className="text-purple-300 underline" href="/settings/ssh-keys">Settings → SSH Keys</a>. Keys are published as NIP‑52 (gitnostr) events so every bridge can authorize you.
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Push to Nostr</h3>
              <p>After making local changes, click "Push to Nostr" in your repository settings to publish updates.</p>
              <p className="mt-2 text-sm text-gray-400">
                We sign the NIP‑34 event, publish it to your relays, and sync the Git repo to relay.ngit.dev/gittr.space automatically. Only small metadata files live inside the Nostr event; the real Git objects stay on the bridge.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">SSH Keys</h3>
              <p>Manage your SSH keys in Settings → SSH Keys. You'll need these for Git operations over SSH.</p>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-sm text-gray-400 mb-2">For complete documentation on SSH and Git operations:</p>
              <a 
                href="https://github.com/arbadacarbaYK/gittr/blob/main/docs/SSH_GIT_GUIDE.md" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline text-sm"
              >
                📖 SSH & Git Access Guide →
              </a>
            </div>
          </div>
        </section>

        {/* Payments & Bounties */}
        <section id="payments" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Coins className="h-6 w-6 text-yellow-400" />
            Payments & Bounties
          </h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-400" />
                Zaps
              </h3>
              <p>Zap repositories to support contributors. Zaps are split automatically based on contributor weights.</p>
              
              <div className="mt-3 p-3 bg-purple-900/20 border border-purple-600/50 rounded">
                <p className="text-purple-200 font-semibold mb-2">💬 Payment Messages:</p>
                <p className="text-sm text-purple-200/90">
                  All zaps and bounties automatically include a payment message with your username, "via gittr.space", and bolt emojis (⚡⚡). 
                  This helps recipients identify where the payment came from. The message format is: <code className="text-purple-300">{"{username} via gittr.space ⚡⚡"}</code> (max 160 characters).
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm text-purple-200/90 mt-2 ml-4">
                  <li><strong>Zaps:</strong> The message is included in the invoice comment field (visible to the recipient)</li>
                  <li><strong>Bounties:</strong> The message is included in the withdraw link title (visible when claiming the bounty)</li>
                  <li>Your username is automatically fetched from your Nostr profile (Kind 0 metadata)</li>
                </ul>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Bounties</h3>
              <p>Anyone can fund issues with bounties to incentivize contributions. Bounties use LNURL-withdraw links created from the bounty creator's LNbits wallet. The funds are reserved in the creator's wallet and will be deducted when the PR author claims the withdraw link.</p>
              
              <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-600/50 rounded">
                <p className="text-yellow-200 font-semibold mb-2">⚠️ Important Requirements:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-yellow-200/90 ml-4">
                  <li><strong>Bounty Creator:</strong> Must have LNbits sending wallet configured in Settings → Account</li>
                  <li><strong>Bounty Creator:</strong> Must ensure sufficient balance remains in wallet until PR author claims the withdraw link</li>
                  <li><strong>PR Author:</strong> Must have a valid Nostr pubkey (not a GitHub username)</li>
                  <li><strong>PR Author:</strong> Must have a Lightning address (<code className="text-yellow-300">lud16</code> or <code className="text-yellow-300">lnurl</code>) in their Nostr profile (Kind 0 metadata)</li>
                </ul>
              </div>

              <p className="mt-4"><strong>Bounty Flow:</strong></p>
              <ol className="list-decimal list-inside space-y-1 ml-4 mt-2 text-sm">
                <li><strong>Bounty Creation:</strong> Anyone can create a bounty on any issue. The system checks if the creator has LNbits configured. If not, they're prompted to set it up in Settings → Account.</li>
                <li><strong>Withdraw Link Creation:</strong> When a bounty is created, an LNURL-withdraw link is generated from the bounty creator's LNbits wallet. The funds are <strong>reserved</strong> (not immediately deducted) and remain in the creator's wallet.</li>
                <li><strong>PR Creation:</strong> A developer creates a PR fixing the issue and links it to the issue number.</li>
                <li><strong>PR Merge:</strong> Only the repo owner can merge PRs. When they merge a PR linked to an issue with a bounty, the withdraw link is <strong>released</strong> to the PR author.</li>
                <li><strong>Bounty Claim:</strong> The PR author receives the withdraw link and can claim the bounty. When they claim it, the funds are deducted from the bounty creator's LNbits wallet and sent to the PR author's Lightning address (from their Nostr profile).</li>
                <li><strong>Issue Closed Without PR:</strong> If an issue with a bounty is closed without a linked PR (e.g., the feature already exists, duplicate issue, etc.), the bounty withdraw link is automatically <strong>deleted</strong> and the bounty is cancelled. The bounty creator will be notified of the cancellation.</li>
              </ol>

              <div className="mt-4 p-4 bg-blue-900/20 border border-blue-600/50 rounded">
                <p className="text-blue-200 font-semibold mb-2">🔒 Bounty Protection & Trust Model:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-blue-200/90 ml-4">
                  <li><strong>Bounty Deletion Prevention:</strong> If a PR is linked to an issue with a bounty, the bounty <strong>cannot be deleted</strong> even if the issue is closed. This protects developers who are working on the fix.</li>
                  <li><strong>Trust Model:</strong> We trust the repo owner/maintainer to verify that a merged PR actually fixes the issue. When a repo owner merges a PR linked to a bounty, they are attesting that the PR resolves the issue. This is a reasonable trust model - the repo owner has the most context about whether a fix is valid.</li>
                  <li><strong>Fraud Prevention:</strong> If you don't trust a repo owner, don't create bounties on their repos. The system relies on the repo owner's judgment when merging PRs.</li>
                  <li><strong>Bounty Cancellation:</strong> Bounties are automatically cancelled (withdraw link deleted) when an issue is closed without a PR. The bounty creator is notified via Nostr DM and/or Telegram (if enabled).</li>
                </ul>
              </div>

              <div className="mt-4 p-4 bg-gray-800/50 border border-gray-700 rounded">
                <p className="text-sm font-semibold text-white mb-2">Bounty Flow Diagram:</p>
                <div className="overflow-x-auto">
                  <div ref={mermaidRef} className="min-h-[500px] flex items-center justify-center w-full"></div>
                </div>
              </div>

              <p className="mt-4"><strong>Bounty statuses:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li><span className="text-yellow-400">Pending</span> - Bounty amount set but withdraw link not yet created</li>
                <li><span className="text-green-400">Paid</span> - Withdraw link created and ready (funds reserved in bounty creator's wallet)</li>
                <li><span className="text-purple-400">Released</span> - Withdraw link released to PR author (they can claim it)</li>
                <li><span className="text-red-400">Cancelled</span> - Bounty was cancelled (issue closed without PR, withdraw link deleted)</li>
                <li><span className="text-gray-400">Offline</span> - Payment state cannot be tracked</li>
              </ul>

              <p className="mt-4 text-sm text-gray-400"><strong>Key Points:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2 text-sm text-gray-400">
                <li>Bounties use <strong>withdraw links</strong>, not direct payments. The funds stay in the creator's wallet until claimed.</li>
                <li>The bounty creator must ensure their LNbits wallet has sufficient balance until the PR author claims the withdraw link.</li>
                <li>No account credentials are stored on the platform - everything uses the creator's local LNbits configuration.</li>
                <li>The PR author's Lightning address is fetched from their Nostr profile (Kind 0 metadata), looking for <code className="text-purple-400">lud16</code> or <code className="text-purple-400">lnurl</code> fields.</li>
                <li>If the PR author doesn't have a Lightning address in their Nostr profile, the bounty cannot be claimed.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Bounty Hunt</h3>
              <p>Visit the <Link href="/bounty-hunt" className="text-yellow-400 hover:text-yellow-300">Bounty Hunt</Link> page to discover funded issues across all repositories.</p>
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section id="notifications" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Bell className="h-6 w-6 text-cyan-400" />
            Notifications
          </h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Configure Notifications</h3>
              <p>Go to Settings → Notifications to set up:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li><strong>Nostr DMs</strong> - Receive encrypted direct messages on Nostr</li>
                <li><strong>Telegram</strong> - Get notifications via Telegram DMs. Configure your Telegram User ID to receive private notifications for PRs, issues, and bounties.</li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">Bounty announcements are also posted to the public <a href="https://t.me/gittrspace" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">@gittrspace</a> channel.</p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Notification Events</h3>
              <p>You can enable/disable notifications for:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li><strong>New issue in watched repos</strong> - When someone opens an issue in a repository you're watching</li>
                <li><strong>Comments on issues I opened/participate</strong> - When someone comments on an issue you created or are assigned to</li>
                <li><strong>New pull request in watched repos</strong> - When someone opens a PR in a repository you're watching</li>
                <li><strong>Reviews requested or comments on my PRs</strong> - When someone requests your review or comments on your PR</li>
                <li><strong>My PR merged</strong> - When your pull request is merged</li>
                <li><strong>I am @mentioned</strong> - When someone mentions you in a comment or description</li>
                <li><strong>My Bounties</strong> - When a bounty is funded on an issue you created (you'll be notified about the bounty amount)</li>
                <li><strong>Bounty released to me</strong> - When a bounty withdraw link is released to you after a PR you created is merged</li>
              </ul>
              <p className="mt-3 text-sm text-gray-400"><strong>Default Settings:</strong> Most notifications are disabled by default to reduce noise. The recommended settings (enabled by default) are: New issues, Issue comments, New PRs, PR reviews, PR merges, Mentions, My Bounties, and Bounty releases.</p>
              <p className="mt-2 text-sm text-gray-400"><strong>Important:</strong> Changes to notification preferences are not active until you click "SAVE NOW". Make sure to save your preferences after making changes.</p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Bounty Notifications</h3>
              <p>Bounty notifications are sent to:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2 text-sm">
                <li><strong>Issue Owner (My Bounties):</strong> When someone funds a bounty on your issue, you'll receive a notification via Nostr DM and/or Telegram (if enabled) with the bounty amount and issue details.</li>
                <li><strong>PR Author (Bounty released to me):</strong> When a PR you created is merged and linked to an issue with a bounty, you'll receive a notification that the bounty withdraw link has been released to you. The notification includes the bounty amount and instructions on how to claim it.</li>
                <li><strong>Bounty Creator (Bounty cancelled):</strong> When an issue with your bounty is closed without a PR, you'll receive a notification that the bounty was cancelled and the withdraw link was deleted. This helps you know that your funds are no longer reserved.</li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">Bounty announcements are also automatically posted to the public <a href="https://t.me/gittrspace" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">@gittrspace</a> Telegram channel, regardless of your notification preferences.</p>
            </div>
          </div>
        </section>

        {/* Collaboration */}
        <section id="collaboration" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4">Collaboration</h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Pull Requests</h3>
              <p>Create PRs to propose changes. Reviewers can approve, request changes, or merge PRs.</p>
              <p className="mt-2 text-sm text-gray-400">
                <strong>Automatic Nostr Publishing:</strong> PRs are automatically published to Nostr (kind 9804) when created. When merged, the updated status is also published automatically. This enables cross-platform sync with other Nostr clients (e.g., gitworkshop.dev).
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Issues</h3>
              <p>Track bugs, feature requests, and discussions. Add bounties to incentivize solutions.</p>
              <p className="mt-2 text-sm text-gray-400">
                <strong>Automatic Nostr Publishing:</strong> Issues are automatically published to Nostr (kind 9803) when created. When closed or reopened, the updated status is also published automatically. This enables cross-platform sync with other Nostr clients.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Contributors</h3>
              <p>Link your GitHub profile in Settings to show your profile picture as a contributor icon.</p>
            </div>
          </div>
        </section>

        {/* Technical Details */}
        <section id="technical" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4">Technical Details</h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Supported Nostr Event Kinds</h3>
              <p className="mb-3">gittr.space uses the following Nostr event kinds for different features:</p>
              <ul className="space-y-2 text-sm">
                <li><strong className="text-white">Kind 0</strong> (NIP-01: Metadata) - User profiles and identities</li>
                <li><strong className="text-white">Kind 1</strong> (NIP-01: Notes) - Comments on issues, PRs, and discussions</li>
                <li><strong className="text-white">Kind 50</strong> (gitnostr: Repository Permissions) - Repository access control</li>
                <li><strong className="text-white">Kind 51</strong> (gitnostr: Repository) - Repository announcements (legacy, for backwards compatibility)</li>
                <li><strong className="text-white">Kind 52</strong> (gitnostr: SSH Keys) - SSH public keys for Git authentication</li>
                <li><strong className="text-white">Kind 30617</strong> (NIP-34: Replaceable Events) - Repository metadata (primary method, uses NIP-34 replaceable events)</li>
                <li><strong className="text-white">Kind 7</strong> (NIP-25: Reactions) - Repository stars (reactions to kind 30617 events)</li>
                <li><strong className="text-white">Kind 9735</strong> (NIP-57: Zaps) - Lightning payments and tips</li>
                <li><strong className="text-white">Kind 9803</strong> (Custom: Issues) - Issue tracking with bounties</li>
                <li><strong className="text-white">Kind 9804</strong> (Custom: Pull Requests) - Pull requests and code reviews</li>
                <li><strong className="text-white">Kind 9806</strong> (Custom: Bounties) - Bounty creation and status updates</li>
                <li><strong className="text-white">Kind 3000</strong> (NIP-51: Bookmark Lists) - Following/watching repositories</li>
              </ul>
              <p className="mt-3 text-sm text-gray-400">
                <strong>Note:</strong> Repository announcements use Kind 30617 (NIP-34 replaceable events) as the primary method. Kind 51 is supported for reading legacy repositories. Stars use NIP-25 (Kind 7) reactions with a "k" tag pointing to the repository event, enabling platform-wide star counts. Following repositories uses NIP-51 (Kind 3000) bookmark lists. Issues and PRs (kinds 9803/9804) are automatically published to Nostr when created, and status updates (merged, closed, reopened) are also published automatically. This enables cross-platform sync with other Nostr clients.
              </p>
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Shield className="h-6 w-6 text-red-400" />
            Security & Privacy
          </h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Local Storage</h3>
              <p>All your data (repos, keys, settings) is stored locally in your browser. It never leaves your device unless you explicitly push to Nostr.</p>
              
              <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded">
                <p className="text-yellow-200 font-semibold mb-2">⚠️ Browser & Domain Isolation</p>
                <p className="text-sm text-gray-300 mb-2">
                  Your data is stored separately for each browser and domain:
                </p>
                <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                  <li><strong>Different browsers</strong> (Chrome, Brave, Firefox) have separate storage</li>
                  <li><strong>Different domains</strong> (localhost:3000 vs gittr.space) have separate storage</li>
                  <li>Repos, PRs, Issues, and edits are <strong>not shared</strong> between browsers/domains</li>
                </ul>
                <p className="text-sm text-gray-300 mt-2">
                  <strong>If you're missing repos, PRs, or edits:</strong> They might be in a different browser or on a different domain. 
                  Use the <Link href="/explore" className="text-purple-400 hover:text-purple-300">Explore page</Link> to see all repos from Nostr (consistent across browsers).
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Encrypted Keys</h3>
              <p>Your Nostr private key and payment credentials are encrypted with a password you set. Enable encryption in Settings → Security.</p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Public vs Private</h3>
              <p>Repositories default to public when pushed to Nostr. You can set them to private in repository settings.</p>
            </div>
          </div>
        </section>

        {/* Additional Resources */}
        <section className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4">Additional Resources</h2>
          
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Documentation</h3>
              <ul className="space-y-2">
                <li>
                  <a href="https://github.com/arbadacarbaYK/gittr" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 flex items-center gap-2">
                    <Github className="h-4 w-4" />
                    GitHub Repository
                  </a>
                </li>
                <li>
                  <a href="https://github.com/arbadacarbaYK/gittr/blob/main/docs/NIP46_REMOTE_SIGNER_INTEGRATION.md" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">
                    NIP-46 Remote Signer Integration
                  </a>
                </li>
                <li>
                  <a href="https://github.com/arbadacarbaYK/gittr/blob/main/docs/NIP25_STARS_NIP51_FOLLOWING.md" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">
                    NIP-25 Stars & NIP-51 Following
                  </a>
                </li>
                <li>
                  <Link href="/settings/notifications" className="text-purple-400 hover:text-purple-300">
                    Notification Settings
                  </Link>
                </li>
                <li>
                  <Link href="/settings/profile" className="text-purple-400 hover:text-purple-300">
                    Profile & Verified Identities
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Need More Help?</h3>
              <p>If you have questions or encounter issues, please check the GitHub repository or open an issue.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
