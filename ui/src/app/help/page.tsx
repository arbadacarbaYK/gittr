"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
// @ts-ignore - lucide-react types are built-in, this is a TypeScript language server cache issue
import { BookOpen, Code, GitBranch, Zap, Coins, Settings, Shield, Bell, Github, HelpCircle } from "lucide-react";

export default function HelpPage() {
  const mermaidRef = useRef<HTMLDivElement>(null);

  // Render Mermaid diagram
  useEffect(() => {
    if (!mermaidRef.current || typeof window === "undefined") return;

    let isMounted = true;

    // Dynamically import Mermaid (client-side only)
    // @ts-ignore - mermaid types may not be available, but module exists at runtime
    import("mermaid").then((mermaidModule: any) => {
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
            <li>• <Link href="#code-snippets" className="text-green-400 hover:text-green-300">Code Snippets</Link></li>
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
              <div className="space-y-2">
                <p>For better security, download a NIP-07 browser extension like:</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>
                    <a
                      className="underline text-purple-400 hover:text-purple-300"
                      href="https://www.getflamingo.org"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Flamingo
                    </a>{" "}
                    (Chrome/Edge)
                  </li>
                  <li>
                    <a
                      className="underline text-purple-400 hover:text-purple-300"
                      href="https://addons.mozilla.org/en-US/firefox/addon/nos2x-fox/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      nos2x-fox
                    </a>{" "}
                    (Firefox)
                  </li>
                  <li>
                    <a
                      className="underline text-purple-400 hover:text-purple-300"
                      href="https://getalby.com"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Alby
                    </a>{" "}
                    (Chrome/Firefox)
                  </li>
                </ul>
                <p className="text-sm text-gray-400 mt-3">
                  <strong className="text-white">On mobile browsers:</strong> Mobile browsers don't support browser extensions. Install{" "}
                  <a
                    className="underline text-purple-400 hover:text-purple-300"
                    href="https://github.com/haorendashu/nowser"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Nowser
                  </a>{" "}
                  to sign via NIP-46/NIP-07, or use a remote signer (NIP-46) with a hardware device.
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  Once installed, the extension will automatically detect when you visit the login page and allow you to sign in securely.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">2. Create or Import a Repository</h3>
              <p className="mb-3">You can create a new repository or import from GitHub/GitLab/Codeberg. There are three ways to get started:</p>
              
              <div className="space-y-3 mt-3">
                <div className="p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                  <p className="text-sm font-semibold text-blue-200 mb-2">📦 Option 1: Import Single Repository</p>
                  <p className="text-sm text-gray-300 mb-2">Import an existing repository from GitHub, GitLab, or Codeberg:</p>
                  <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                    <li>Enter <code className="bg-gray-800 px-1 rounded">owner/repo</code> (e.g., <code className="bg-gray-800 px-1 rounded">arbadacarbaYK/gittr</code>)</li>
                    <li>Or provide a full URL: <code className="bg-gray-800 px-1 rounded">https://github.com/owner/repo</code></li>
                    <li>Files are automatically fetched and stored in your browser</li>
                  </ul>
                </div>

                <div className="p-3 bg-purple-900/20 border border-purple-600/30 rounded">
                  <p className="text-sm font-semibold text-purple-200 mb-2">➕ Option 2: Create Empty Repository</p>
                  <p className="text-sm text-gray-300 mb-2">Create a new empty repository from scratch:</p>
                  <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                    <li>Enter a repository name</li>
                    <li>Click "Create Empty Repository"</li>
                    <li><strong className="text-yellow-400">Important:</strong> The repository will be empty until you push files via Git (see below)</li>
                  </ul>
                </div>

                <div className="p-3 bg-green-900/20 border border-green-600/30 rounded">
                  <p className="text-sm font-semibold text-green-200 mb-2">📚 Option 3: Bulk Import from GitHub</p>
                  <p className="text-sm text-gray-300 mb-2">Import multiple repositories at once from a GitHub user or organization:</p>
                  <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                    <li>Click "Bulk Import from GitHub"</li>
                    <li>Browse and select which repositories to import</li>
                    <li>You can import all or just specific ones</li>
                  </ul>
                </div>
              </div>

              <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded">
                <p className="text-sm font-semibold text-yellow-200 mb-2">⚠️ Important: Getting Files Into Your Repository</p>
                <p className="text-sm text-gray-300 mb-2">
                  <strong>For empty repositories created via web UI:</strong> After creating an empty repository, you need to push files to it before they appear in the web UI. The workflow is:
                </p>
                <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside ml-2">
                  <li><strong>Clone the repository:</strong> <code className="bg-gray-800 px-1 rounded">git clone git@gittr.space:&lt;your-pubkey&gt;/&lt;repo-name&gt;.git</code></li>
                  <li><strong>Add your files:</strong> Copy files into the cloned directory, or create new files</li>
                  <li><strong>Commit your changes:</strong> <code className="bg-gray-800 px-1 rounded">git add . && git commit -m "Initial commit"</code></li>
                  <li><strong>Push to the repository:</strong> <code className="bg-gray-800 px-1 rounded">git push origin main</code></li>
                </ol>
                <p className="text-sm text-gray-300 mt-2">
                  <strong>Why this is necessary:</strong> The git-nostr-bridge stores repositories as bare Git repositories. Files only appear in the web UI after they've been committed and pushed via Git.
                </p>
                <p className="text-sm text-gray-300 mt-2">
                  <strong>For imported repositories:</strong> Files are automatically fetched during import, so they appear immediately in the web UI.
                </p>
              </div>
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
              <p className="mb-3">You can create repositories in three ways:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mb-3">
                <li><strong>Import from GitHub/GitLab/Codeberg:</strong> Files are automatically fetched and stored in your browser</li>
                <li><strong>Create empty repository:</strong> Creates an empty repo that you must populate via Git CLI (clone, add files, commit, push)</li>
                <li><strong>Bulk import:</strong> Import multiple repositories at once from a GitHub user/organization</li>
              </ul>
              <p className="text-sm text-gray-400 mb-3">
                All repos are stored locally in your browser and can be pushed to Nostr for public access. 
                <strong className="text-yellow-400"> Important:</strong> Empty repositories created via web UI will not show files until you push them via Git.
              </p>
              <div className="p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm font-semibold text-blue-200 mb-2">📖 Complete Workflow for Empty Repositories</p>
                <p className="text-sm text-gray-300 mb-2">After creating an empty repository via web UI:</p>
                <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside ml-2">
                  <li>Set up SSH keys in <strong>Settings → SSH Keys</strong> (if not already done)</li>
                  <li>Clone: <code className="bg-gray-800 px-1 rounded">git clone git@gittr.space:&lt;your-pubkey&gt;/&lt;repo-name&gt;.git</code></li>
                  <li>Add files: Copy files into the cloned directory or create new files</li>
                  <li>Commit: <code className="bg-gray-800 px-1 rounded">git add . && git commit -m "Initial commit"</code></li>
                  <li>Push: <code className="bg-gray-800 px-1 rounded">git push origin main</code></li>
                </ol>
                <p className="text-sm text-gray-300 mt-2">
                  Files will appear in the web UI after pushing. See <a href="#git-operations" className="text-blue-300 underline">Git Operations</a> section for detailed instructions.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Repository Status</h3>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li><span className="text-yellow-400">Local</span> - Only exists on your device</li>
                <li><span className="text-blue-400">Pushing...</span> - Currently being published to Nostr</li>
                <li><span className="text-green-400">Live on Nostr</span> - Published and visible to others</li>
                <li><span className="text-orange-400">Live (Unpushed Edits)</span> - Has local changes not yet published</li>
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
                <li><strong>GitHub</strong> - Single repo or bulk import (link your GitHub identity via NIP-39 in Profile settings)</li>
                <li><strong>GitLab</strong> - Import from GitLab URLs (coming soon)</li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">Imported repos maintain a link to their source (sourceUrl) and fetch files from the original git server.</p>
              
              <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm text-blue-200 font-semibold mb-2">🔒 Private Repository Support</p>
                <p className="text-sm text-blue-100 mb-2">
                  <strong>GitHub Private Repos:</strong> When you import a private GitHub repository, the privacy status is preserved locally. The repository will be marked as "Private" in gittr.space. Privacy is enforced via the <code className="bg-blue-900/50 px-1 rounded">maintainers</code> tag (NIP-34 spec) and bridge access control.
                </p>
                <ul className="text-sm text-blue-100 space-y-1 list-disc list-inside ml-2 mb-3">
                  <li><strong>NIP-34 Spec Compliance:</strong> Privacy is NOT encoded in NIP-34 event tags (per spec). The NIP-34 spec does not include <code className="bg-blue-900/50 px-1 rounded">public-read</code> or <code className="bg-blue-900/50 px-1 rounded">public-write</code> tags. Privacy is determined by the <code className="bg-blue-900/50 px-1 rounded">maintainers</code> tag (which IS in the spec) and bridge-level access control.</li>
                  <li><strong>Files Access:</strong> Files from private GitHub repos require GitHub authentication. Connect your GitHub account via OAuth (Settings → SSH Keys) to access private repo files.</li>
                  <li><strong>Other Clients:</strong> Other NIP-34 clients can see repository events on relays (for discoverability), but file access is restricted to maintainers via the bridge. Clients that support the <code className="bg-blue-900/50 px-1 rounded">maintainers</code> tag can identify private repos and enforce access control accordingly.</li>
                  <li><strong>Access Control:</strong> Only users listed in the <code className="bg-blue-900/50 px-1 rounded">maintainers</code> tag (or the repository owner) can access private repos. This is enforced at the bridge level for Git operations (SSH/HTTPS) and at the API level for file fetching.</li>
                </ul>
                
                <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded">
                  <p className="text-sm font-semibold text-yellow-200 mb-2">🔗 Identity Mapping & Access Control</p>
                  <p className="text-sm text-yellow-100 mb-2">
                    <strong>How Access Works:</strong> Access to private repositories is determined by your <strong>Nostr pubkey (npub)</strong>, not your GitHub username. This means:
                  </p>
                  <ul className="text-sm text-yellow-100 space-y-1 list-disc list-inside ml-2 mb-3">
                    <li><strong>Owner:</strong> The repository owner (the Nostr pubkey that created/pushed the repo) has full access</li>
                    <li><strong>Maintainers:</strong> Users whose Nostr pubkey (npub) is explicitly added as a maintainer in Repository Settings → Contributors</li>
                    <li><strong>GitHub Identity:</strong> If you're a maintainer on GitHub but haven't linked your Nostr identity, you won't have access until the owner adds your npub</li>
                  </ul>
                  <p className="text-sm text-yellow-100 mb-2">
                    <strong>Why This Matters:</strong> When importing from GitHub, contributors are mapped to Nostr identities using:
                  </p>
                  <ol className="text-sm text-yellow-100 space-y-1 list-decimal list-inside ml-2 mb-3">
                    <li><strong>OAuth Mapping:</strong> If you've done GitHub OAuth, your GitHub username is linked to your Nostr pubkey in localStorage</li>
                    <li><strong>NIP-39 Claims:</strong> If you've published a Kind 0 event with <code className="bg-yellow-900/50 px-1 rounded">["i", "github:username"]</code> tags, your identity is claimed on Nostr</li>
                    <li><strong>Manual Addition:</strong> The repository owner can manually add maintainers by their npub in Repository Settings</li>
                  </ol>
                  <p className="text-sm text-yellow-200 font-semibold mb-1">⚠️ Common Issue: "Access Denied" for Maintainers</p>
                  <p className="text-sm text-yellow-100 mb-2">
                    If you're a maintainer on GitHub but can't access a private repo on gittr.space:
                  </p>
                  <ul className="text-sm text-yellow-100 space-y-1 list-disc list-inside ml-2">
                    <li>The repository owner needs to add your <strong>Nostr pubkey (npub)</strong> as a maintainer in Repository Settings → Contributors</li>
                    <li>Your GitHub username alone isn't enough - you need your npub explicitly added</li>
                    <li>This ensures security: only the owner can grant access, and it's tied to your Nostr identity, not just GitHub</li>
                  </ul>
                </div>
                
                <div className="mt-3 p-3 bg-purple-900/20 border border-purple-600/30 rounded">
                  <p className="text-sm font-semibold text-purple-200 mb-2">💻 CLI & API Access</p>
                  <p className="text-sm text-purple-100 mb-2">
                    When accessing private repositories via Git CLI or API:
                  </p>
                  <ul className="text-sm text-purple-100 space-y-1 list-disc list-inside ml-2 mb-2">
                    <li><strong>Git Clone:</strong> Requires SSH keys configured in Settings → SSH Keys. The bridge checks your pubkey against the repository's maintainers list.</li>
                    <li><strong>Error Message:</strong> If access is denied, you'll see: <code className="bg-purple-900/50 px-1 rounded">fatal: permission denied for read operation</code> with hints on how to get access.</li>
                    <li><strong>API Endpoints:</strong> Private repo endpoints gracefully return null/404 for unauthorized users (no errors thrown).</li>
                  </ul>
                  <p className="text-sm text-purple-100">
                    <strong>Note:</strong> The same access control applies - you need your npub added as a maintainer by the owner, regardless of whether you access via web UI, CLI, or API.
                  </p>
                </div>
              </div>
              
              <div className="mt-3 p-3 bg-red-900/20 border border-red-600/30 rounded">
                <p className="text-sm text-red-200 font-semibold mb-1">⚠️ 4 MB Import Limit</p>
                <p className="text-sm text-red-100">
                  Next.js API routes hard-cap responses at ~4 MB. When importing we fetch every file (including releases/binaries), so very large repos will fail with “Repository is too large”. Remove heavy artifacts (release archives, media, build outputs) or import a slimmer subset before retrying.
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
                    git clone https://git.gittr.space/&lt;owner-pubkey&gt;/repo-name.git
                  </code>
                  <p className="mt-1 text-xs text-gray-400">Read-only clones from our public mirrors (git.gittr.space, gitnostr.com, relay.ngit.dev, ngit-relay.nostrver.se, ...). Great for CI/CD or quick testing.</p>
                </div>
                
                <div>
                  <p className="text-sm font-semibold text-purple-400 mb-1">Option C: nostr:// Protocol (Ecosystem Standard)</p>
                  <code className="block bg-[#0a0d11] p-2 rounded text-sm">
                    git clone nostr://yourname@git.gittr.space/repo-name
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
                    <p className="mt-2 font-semibold text-purple-300">How it works:</p>
                    <ul className="list-disc list-inside space-y-1 mt-1">
                      <li><strong>With SSH keys</strong> (added in Settings → SSH Keys): Automatically uses SSH for push/pull operations</li>
                      <li><strong>Without SSH keys</strong>: Falls back to HTTPS (read-only or with credentials)</li>
                    </ul>
                    <p className="mt-2">Once installed, <code className="bg-gray-900 px-1 rounded">git clone nostr://…</code> works with or without SSH keys - git-remote-nostr automatically chooses the best option.</p>
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

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Push to Nostr</h3>
              <p>After making local changes, click "Push to Nostr" in your repository settings to publish updates.</p>
              <p className="mt-2 text-sm text-gray-400">
                We sign the NIP‑34 event, publish it to your relays, and sync the Git repo to git.gittr.space automatically. Only small metadata files live inside the Nostr event; the real Git objects stay on the bridge.
              </p>
              <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm text-blue-200 font-semibold mb-1">📦 File Content During Push</p>
                <p className="text-sm text-blue-100 mb-2">
                  Files are sourced from your browser's localStorage (from create/import workflow) or from the bridge API if missing. The push process does NOT fetch files from external sources (GitHub, GitLab, etc.).
                </p>
                <p className="text-xs text-blue-200">
                  <strong>If files are missing:</strong> Re-import the repository to load all files into localStorage before pushing.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">SSH Keys</h3>
              <p>Manage your SSH keys in Settings → SSH Keys. You'll need these for Git operations over SSH.</p>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-sm text-gray-400 mb-2">For complete documentation on SSH and Git operations:</p>
              <a 
                href="https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr?path=docs&file=docs%2FSSH_GIT_GUIDE.md" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline text-sm"
              >
                📖 SSH & Git Access Guide →
              </a>
            </div>
          </div>
        </section>

        {/* Code Snippets */}
        <section id="code-snippets" className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Code className="h-6 w-6 text-green-400" />
            Code Snippets (NIP-C0)
          </h2>
          
          <div className="space-y-4 text-gray-300">
            <p className="text-sm">
              Select code in any file viewer to share it as a standalone snippet on Nostr. The action bar appears near your selection with options to copy a permalink or share as a snippet.
            </p>
            <p className="text-sm text-gray-400">
              <strong>Mobile-friendly:</strong> Line numbers are hidden on mobile devices to avoid alignment issues, but all functionality is preserved. Code lines remain fully clickable for selection.
            </p>
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Share Code Snippets</h3>
              <p>Share code snippets from your repositories as standalone, discoverable events on Nostr.</p>
              
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-green-400 mb-1">How to Share:</p>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300 ml-2">
                    <li>Open any file in a repository</li>
                    <li>Select the code lines you want to share (click to select, Shift+click to extend)</li>
                    <li>Click the <strong className="text-green-400">"Share as snippet"</strong> button that appears</li>
                    <li>Optionally add a description</li>
                    <li>Click <strong className="text-green-400">"Share to Nostr"</strong></li>
                  </ol>
                </div>
                
                <div>
                  <p className="text-sm font-semibold text-purple-400 mb-1">What Gets Shared:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-300 ml-2">
                    <li>The selected code (with syntax highlighting)</li>
                    <li>Language and file extension (auto-detected)</li>
                    <li>Optional description</li>
                    <li>Link back to source repository (NIP-34 format)</li>
                  </ul>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Using Snippets in Comments</h3>
              <p>Reference code snippets in issue and PR comments. Snippets will appear inline with syntax highlighting.</p>
              
              <div className="mt-3 p-3 bg-purple-900/20 border border-purple-600/50 rounded">
                <p className="text-purple-200 font-semibold mb-2">💡 How it works:</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-purple-200/90 ml-2">
                  <li>Share a code snippet using the "Share as snippet" button</li>
                  <li>Copy the snippet event ID (shown after sharing)</li>
                  <li>Paste the event ID in a comment (as <code className="text-purple-300">nostr:note1...</code> or hex format)</li>
                  <li>The snippet will automatically render inline with syntax highlighting</li>
                </ol>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Snippet Features</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-300 ml-2">
                <li><strong>Syntax Highlighting:</strong> Code is displayed with proper formatting</li>
                <li><strong>Copy Code:</strong> One-click copy button</li>
                <li><strong>Download:</strong> Download snippet as a file</li>
                <li><strong>Repository Link:</strong> Click to view the source repository</li>
                <li><strong>Discoverable:</strong> Snippets are searchable across the Nostr network</li>
              </ul>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-sm text-gray-400 mb-2">Learn more about NIP-C0:</p>
              <a 
                href="https://github.com/nostr-protocol/nips/blob/master/C0.md" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline text-sm"
              >
                📖 NIP-C0 Specification →
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
              
              <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm font-semibold text-blue-200 mb-2">📋 How PRs Are Organized</p>
                <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                  <li><strong>Sorted by creation time:</strong> PRs are displayed with the newest first, regardless of status changes</li>
                  <li><strong>Aggregated from Nostr:</strong> PRs created by anyone (locally or on other clients) appear in the list automatically</li>
                  <li><strong>Status tracking:</strong> Status changes (open → merged/closed) don't affect the chronological order</li>
                  <li><strong>Real-time updates:</strong> New PRs and status changes from Nostr relays appear automatically</li>
                </ul>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Issues</h3>
              <p>Track bugs, feature requests, and discussions. Add bounties to incentivize solutions.</p>
              
              <div className="mt-3 p-3 bg-green-900/20 border border-green-600/30 rounded">
                <p className="text-sm font-semibold text-green-200 mb-2">📋 How Issues Are Organized</p>
                <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                  <li><strong>Sorted by creation time:</strong> Issues are displayed with the newest first, regardless of status changes</li>
                  <li><strong>Aggregated from Nostr:</strong> Issues created by anyone (locally or on other clients) appear in the list automatically</li>
                  <li><strong>Status tracking:</strong> Status changes (open → closed) don't affect the chronological order</li>
                  <li><strong>Real-time updates:</strong> New issues and status changes from Nostr relays appear automatically</li>
                </ul>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white mb-2">Contributors</h3>
              <p>Link your GitHub profile in Settings to show your profile picture as a contributor icon.</p>
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
                  <a href="https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 flex items-center gap-2">
                    <Github className="h-4 w-4" />
                    gittr.space Repository
                  </a>
                </li>
                <li>
                  <a href="https://github.com/arbadacarbaYK/gittr" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 flex items-center gap-2">
                    <Github className="h-4 w-4" />
                    GitHub Mirror
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
