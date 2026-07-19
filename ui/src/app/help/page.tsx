"use client";

import { useEffect, useRef } from "react";

import {
  HelpSection,
  HelpSubTopic,
  HelpTopic,
  openHelpHashTargets,
} from "@/components/ui/help-collapse";
import {
  GITTR_DOC_FILE_FETCHING,
  GITTR_DOC_GITNOSTR_ARCHITECTURE,
  GITTR_DOC_GITNOSTR_SSH,
  GITTR_DOC_SSH_GIT,
  GITTR_REPO_GITNOSTR,
  GITTR_REPO_GITTR,
  GITTR_REPO_HELPER_TOOLS,
} from "@/lib/gittr-repo-links";
import {
  SCHEMATA_NIP25,
  SCHEMATA_NIP34,
  SCHEMATA_NIP46,
  SCHEMATA_NIP51,
  SCHEMATA_NIP57,
  SCHEMATA_NIP_C0,
  SCHEMATA_REPO,
} from "@/lib/nostr/schemata-links";

// @ts-ignore - lucide-react types are built-in, this is a TypeScript language server cache issue
import {
  Bell,
  BookOpen,
  Code,
  Coins,
  GitBranch,
  Github,
  HelpCircle,
  Settings,
  Shield,
  Zap,
} from "lucide-react";
import Link from "next/link";

export default function HelpPage() {
  const mermaidRef = useRef<HTMLDivElement>(null);

  // Deep links from repo sidebar / TOC (e.g. /help#gittr-pages)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const scrollToHash = () => {
      const id = window.location.hash?.replace(/^#/, "");
      if (!id) return;
      openHelpHashTargets(id);
    };

    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

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
        <p className="text-gray-400 max-w-3xl">
          Git collaboration on Nostr: mirror code from any forge, run issues and
          pull requests with signed events, publish Pages, discover apps, and
          use Lightning bounties. Import from GitHub, GitLab, or Codeberg when
          you want a backup — not because gittr is a copy of another site.
        </p>
        <p className="text-gray-400 max-w-3xl mt-3 text-sm">
          <strong className="text-gray-300">NIPs &amp; event kinds:</strong>{" "}
          <a
            href={SCHEMATA_REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 underline"
          >
            Nostr schemata on gittr
          </a>{" "}
          (nostrability) — e.g.{" "}
          <a
            href={SCHEMATA_NIP34}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 underline"
          >
            NIP-34
          </a>{" "}
          for git repos, issues, and PRs.
        </p>
      </header>

      <HelpSection id="what-is-gittr" title={<>What you can do on gittr</>}>
        <ul className="grid gap-3 sm:grid-cols-2 text-sm text-gray-300">
          <li>
            <strong className="text-white">Mirror &amp; backup</strong> — Copy
            repos from your server or a central forge to Nostr git relays
            (GRASP).
          </li>
          <li>
            <strong className="text-white">Issues &amp; PRs on Nostr</strong> —
            Reviews, merge, and push updated repo state so other clients see the
            same tree.
          </li>
          <li id="gittr-pages" className="scroll-mt-24">
            <strong className="text-white">Nostr Pages</strong> — Publish static
            sites from a repo (site file + README block + Push to Nostr /
            Blossom); browse the directory at{" "}
            <Link
              href="/pages"
              className="text-purple-400 hover:text-purple-300"
            >
              /pages
            </Link>
            . Owner tools live in the Code sidebar under{" "}
            <strong className="text-white">Nostr Pages</strong>.
          </li>
          <li>
            <strong className="text-white">Nostr apps</strong> — Discover and
            install apps from{" "}
            <Link
              href="/apps"
              className="text-purple-400 hover:text-purple-300"
            >
              /apps
            </Link>
            . Repo owners can{" "}
            <strong className="text-white">Announce app</strong> from the Code
            sidebar: list an Android app on Nostr from a forge{" "}
            <strong className="text-white">Release</strong> that has an{" "}
            <code className="text-purple-200">.apk</code> (file stays on
            GitHub/Codeberg/GitLab). Zapstore listing is optional and free.
          </li>
          <li>
            <strong className="text-white">Bounties &amp; zaps</strong> — Fund
            issues; pay contributors over Lightning (see Bounties below).
          </li>
          <li>
            <strong className="text-white">Import</strong> — One repo or bulk
            from GitHub/GitLab when you already host code elsewhere.
          </li>
        </ul>
      </HelpSection>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {/* Quick Links */}
        <div className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-purple-400" />
            Quick Start
          </h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>
              •{" "}
              <Link
                href="#getting-started"
                className="text-purple-400 hover:text-purple-300"
              >
                Getting Started
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#repositories"
                className="text-purple-400 hover:text-purple-300"
              >
                Managing Repositories
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#payments"
                className="text-purple-400 hover:text-purple-300"
              >
                Payments & Bounties
              </Link>
            </li>
            <li>
              •{" "}
              <a
                href={SCHEMATA_REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300"
              >
                Nostr schemata (NIPs)
              </a>
            </li>
            <li>
              •{" "}
              <Link
                href="#notifications"
                className="text-purple-400 hover:text-purple-300"
              >
                Notifications
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#pwa-install"
                className="text-purple-400 hover:text-purple-300"
              >
                Install as App (PWA)
              </Link>
            </li>
          </ul>
        </div>

        <div className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Code className="h-5 w-5 text-green-400" />
            Development
          </h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>
              •{" "}
              <Link
                href="#git-operations"
                className="text-green-400 hover:text-green-300"
              >
                Git Operations
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#push-to-nostr"
                className="text-green-400 hover:text-green-300"
              >
                Push to Nostr
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#grasp"
                className="text-green-400 hover:text-green-300"
              >
                GRASP / HTTPS clone
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#gittr-pages"
                className="text-green-400 hover:text-green-300"
              >
                Nostr Pages
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#code-snippets"
                className="text-green-400 hover:text-green-300"
              >
                Code Snippets
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#ssh-keys"
                className="text-green-400 hover:text-green-300"
              >
                SSH Keys
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#collaboration"
                className="text-green-400 hover:text-green-300"
              >
                Collaboration
              </Link>
            </li>
          </ul>
        </div>

        <div className="border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Settings className="h-5 w-5 text-cyan-400" />
            Settings
          </h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>
              •{" "}
              <Link
                href="/settings"
                className="text-cyan-400 hover:text-cyan-300"
              >
                Account Settings
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="/settings/notifications"
                className="text-cyan-400 hover:text-cyan-300"
              >
                Notifications
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="/settings/account"
                className="text-cyan-400 hover:text-cyan-300"
              >
                Account &amp; payments
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="space-y-3">
        {/* Getting Started */}
        <HelpSection id="getting-started" title={<>Getting Started</>}>
          <div className="space-y-2">
            <HelpTopic title={<>1. Login with NIP-07</>}>
              <div className="space-y-2">
                <p>
                  For better security, download a NIP-07 browser extension like:
                </p>
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
                  <strong className="text-white">On mobile browsers:</strong>{" "}
                  Mobile browsers don't support browser extensions. Install{" "}
                  <a
                    className="underline text-purple-400 hover:text-purple-300"
                    href="https://github.com/haorendashu/nowser"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Nowser
                  </a>{" "}
                  to sign via{" "}
                  <a
                    href={SCHEMATA_NIP46}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    NIP-46
                  </a>
                  /NIP-07, or use a remote signer (NIP-46) with a hardware
                  device.
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  Once installed, the extension will automatically detect when
                  you visit the login page and allow you to sign in securely.
                </p>
              </div>
            </HelpTopic>

            <HelpTopic title={<>2. Create or Import a Repository</>}>
              <p className="mb-3">
                You can create a new repository or import from
                GitHub/GitLab/Codeberg. There are three ways to get started:
              </p>

              <div className="space-y-1 mt-2">
                <HelpSubTopic title={<>Option 1: Import single repository</>}>
                  <p>
                    Import an existing repository from GitHub, GitLab, or
                    Codeberg:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>
                      Enter{" "}
                      <code className="bg-gray-800 px-1 rounded">
                        owner/repo
                      </code>{" "}
                      (e.g.{" "}
                      <code className="bg-gray-800 px-1 rounded">
                        arbadacarbaYK/gittr
                      </code>
                      )
                    </li>
                    <li>
                      Or a full URL:{" "}
                      <code className="bg-gray-800 px-1 rounded">
                        https://github.com/owner/repo
                      </code>
                    </li>
                    <li>Files are fetched and stored in your browser</li>
                  </ul>
                </HelpSubTopic>

                <HelpSubTopic title={<>Option 2: Create empty repository</>}>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Enter a repository name</li>
                    <li>Click &quot;Create Empty Repository&quot;</li>
                    <li>Empty until you push files via Git (see below)</li>
                  </ul>
                </HelpSubTopic>

                <HelpSubTopic title={<>Option 3: Bulk import from GitHub</>}>
                  <p>
                    Load a GitHub user/org list, then choose what to import.
                    Opening the bulk page does <strong>not</strong> import
                    anything until you fetch, select, and confirm.
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Open bulk import from New repository</li>
                    <li>
                      <strong>Fetch Repos</strong>, tick what you want
                    </li>
                    <li>
                      Import only runs when you confirm selected (or Import All)
                    </li>
                    <li>
                      Optional: <strong>Also Push selected to Nostr</strong> on
                      the bulk page; otherwise use{" "}
                      <strong>Push to Nostr</strong> per repo later
                    </li>
                  </ul>
                </HelpSubTopic>

                <HelpSubTopic title={<>Getting files into an empty repo</>}>
                  <p>
                    After creating an empty repo in the web UI, push via Git
                    before files show up:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>
                      <code className="bg-gray-800 px-1 rounded">
                        git clone
                        git@gittr.space:&lt;pubkey&gt;/&lt;repo&gt;.git
                      </code>
                    </li>
                    <li>Add files in the clone</li>
                    <li>
                      <code className="bg-gray-800 px-1 rounded">
                        git add . && git commit -m &quot;Initial commit&quot;
                      </code>
                    </li>
                    <li>
                      <code className="bg-gray-800 px-1 rounded">
                        git push origin main
                      </code>
                    </li>
                  </ol>
                  <p className="text-gray-400 text-xs mt-2">
                    Imported repos already include files in the UI. The bridge
                    only shows committed/pushed trees for empty creates.
                  </p>
                </HelpSubTopic>
              </div>
            </HelpTopic>

            <HelpTopic title={<>3. Set Up Payments (Optional)</>}>
              <p>
                Go to Settings → Account to configure LNbits (send/receive
                keys), Lightning address (
                <code className="text-gray-400">lud16</code> /{" "}
                <code className="text-gray-400">lnurl</code> receive), or NWC.
                Repository-specific overrides live under each repo&apos;s
                Settings → Payment configuration.
              </p>
            </HelpTopic>
          </div>
        </HelpSection>

        {/* PWA Install */}
        <HelpSection
          id="pwa-install"
          title={<>Install gittr as an App (PWA)</>}
        >
          <div className="space-y-2">
            <p>
              gittr is installable as a Progressive Web App (PWA) on modern
              browsers. This gives you an app icon, standalone window, and
              offline fallback page.
            </p>
            <HelpTopic title={<>Desktop (Chrome/Edge/Brave)</>}>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Open gittr in your browser (HTTPS required).</li>
                <li>
                  Click the install icon in the address bar, or go to the menu →
                  <strong className="text-white"> Install app</strong>.
                </li>
                <li>Confirm to add gittr to your desktop/app launcher.</li>
              </ul>
            </HelpTopic>
            <HelpTopic title={<>iOS (Safari)</>}>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Open gittr in Safari.</li>
                <li>Tap Share → Add to Home Screen.</li>
              </ul>
            </HelpTopic>
            <HelpTopic title={<>Android (Chrome/Brave)</>}>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Open gittr in Chrome or Brave.</li>
                <li>
                  Tap the menu →{" "}
                  <strong className="text-white">Install app</strong>.
                </li>
              </ul>
            </HelpTopic>
            <p className="text-sm text-gray-400">
              Note: In-app browsers (Telegram/Twitter, etc.) often block PWA
              install. Open in the system browser. Offline mode only shows a
              fallback screen and does not replace full online functionality.
            </p>
          </div>
        </HelpSection>

        {/* Repositories */}
        <HelpSection
          id="repositories"
          title={
            <>
              <GitBranch className="h-6 w-6 text-purple-400" />
              Managing Repositories
            </>
          }
        >
          <div className="space-y-2">
            <HelpTopic title={<>Creating Repositories</>}>
              <p className="mb-3">You can create repositories in three ways:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mb-3">
                <li>
                  <strong>Import from GitHub/GitLab/Codeberg:</strong> Files are
                  automatically fetched and stored in your browser
                </li>
                <li>
                  <strong>Create empty repository:</strong> Creates an empty
                  repo that you must populate via Git CLI (clone, add files,
                  commit, push)
                </li>
                <li>
                  <strong>Bulk import:</strong> Lists repos from a GitHub
                  user/org for you to pick; nothing imports until you confirm.
                  You can import several chosen repos in one click.
                </li>
              </ul>
              <p className="text-sm text-gray-400 mb-3">
                All repos are stored locally in your browser and can be pushed
                to Nostr for public access.
                <strong className="text-yellow-400"> Important:</strong> Empty
                repositories created via web UI will not show files until you
                push them via Git.
              </p>
              <div className="p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm font-semibold text-blue-200 mb-2">
                  📖 Complete Workflow for Empty Repositories
                </p>
                <p className="text-sm text-gray-300 mb-2">
                  After creating an empty repository via web UI:
                </p>
                <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside ml-2">
                  <li>
                    Set up SSH keys in <strong>Settings → SSH Keys</strong> (if
                    not already done)
                  </li>
                  <li>
                    Clone:{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      git clone
                      git@gittr.space:&lt;your-pubkey&gt;/&lt;repo-name&gt;.git
                    </code>
                  </li>
                  <li>
                    Add files: Copy files into the cloned directory or create
                    new files
                  </li>
                  <li>
                    Commit:{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      git add . && git commit -m "Initial commit"
                    </code>
                  </li>
                  <li>
                    Push:{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      git push origin main
                    </code>
                  </li>
                </ol>
                <p className="text-sm text-gray-300 mt-2">
                  Files will appear in the web UI after pushing. See{" "}
                  <a href="#git-operations" className="text-blue-300 underline">
                    Git Operations
                  </a>{" "}
                  section for detailed instructions.
                </p>
              </div>
            </HelpTopic>

            <HelpTopic title={<>Repository Status</>}>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>
                  <span className="text-yellow-400">Local</span> - Only exists
                  on your device
                </li>
                <li>
                  <span className="text-blue-400">Pushing...</span> - Currently
                  being published to Nostr
                </li>
                <li>
                  <span className="text-green-400">Live on Nostr</span> -
                  Published and visible to others
                </li>
                <li>
                  <span className="text-orange-400">Live (Unpushed Edits)</span>{" "}
                  - Has local changes not yet published
                </li>
                <li>
                  <span className="text-red-400">Push Failed</span> -
                  Publication attempt failed
                </li>
              </ul>
            </HelpTopic>

            <HelpTopic title={<>Repo toolbar: Watch, Star, Zaps</>}>
              <ul className="list-disc list-inside space-y-1 ml-4 text-sm text-gray-300">
                <li>
                  <strong>Watch</strong> — publishes your{" "}
                  <a
                    href={SCHEMATA_NIP51}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    NIP-51
                  </a>{" "}
                  kind <strong>10018</strong> followed-repos list (one
                  replaceable event with the full{" "}
                  <code className="text-gray-400">a</code> tag set each time).
                </li>
                <li>
                  <strong>Star</strong> —{" "}
                  <a
                    href={SCHEMATA_NIP25}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    NIP-25
                  </a>{" "}
                  kind <strong>7</strong> reaction on the repo&apos;s kind{" "}
                  <strong>30617</strong> event (needs a published repo
                  announcement on relays). Also listed on your{" "}
                  <strong>Stars</strong> page. Not the same as Watch.
                </li>
                <li>
                  <strong>Zaps</strong> — shortcut to tip; totals combine Nostr
                  zap receipts and this device&apos;s ledger where relevant.
                </li>
              </ul>
            </HelpTopic>

            <HelpTopic title={<>File Management</>}>
              <p>
                View, edit, and delete files directly in the browser. Use the
                fuzzy file finder (Cmd/Ctrl+P) to quickly navigate large
                repositories.
              </p>
            </HelpTopic>

            <HelpTopic title={<>File Sources & NIP-34 Architecture</>}>
              <p>
                gittr.space follows the{" "}
                <a
                  href={SCHEMATA_NIP34}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  NIP-34
                </a>{" "}
                architecture for file storage. Files are stored on git servers
                (via{" "}
                <a
                  href={GITTR_DOC_GITNOSTR_ARCHITECTURE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  gitnostr bridge
                </a>
                ), not in Nostr events. The repository&apos;s &quot;About&quot;
                sidebar shows where files come from:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li>
                  <span className="text-gray-400">📦 Embedded</span> - Files
                  stored directly in Nostr event (legacy repos)
                </li>
                <li>
                  <span className="text-gray-400">⚡ git-nostr-bridge</span> -
                  Files stored on decentralized git server
                </li>
                <li>
                  <span className="text-gray-400">🐙 GitHub</span> - Files
                  fetched from GitHub API
                </li>
                <li>
                  <span className="text-gray-400">🦊 GitLab</span> - Files
                  fetched from GitLab API
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">
                This architecture ensures files are stored efficiently and can
                be fetched from multiple sources for redundancy.
              </p>
            </HelpTopic>

            <HelpTopic title={<>Importing Repositories</>}>
              <p>You can import repositories from:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li>
                  <strong>GitHub</strong> - Single repo or bulk import (link
                  your GitHub identity via NIP-39 in Profile settings)
                </li>
                <li>
                  <strong>GitLab</strong> - Import from GitLab URLs (coming
                  soon)
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">
                Imported repos maintain a link to their source (sourceUrl) and
                fetch files from the original git server.
              </p>

              <HelpSubTopic title={<>Private repository support</>}>
                <p className="text-sm text-gray-300 mb-2">
                  <strong>Private on gittr:</strong> Settings → Private saves
                  locally and publishes a gittr extension tag on your kind{" "}
                  <code className="bg-blue-900/50 px-1 rounded">30617</code>{" "}
                  announcement:{" "}
                  <code className="bg-blue-900/50 px-1 rounded">
                    ["public-read","false"]
                  </code>
                  . That is what listings use after a localStorage clear — not a
                  browser-only flag. Core{" "}
                  <a
                    href={SCHEMATA_NIP34}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    NIP-34
                  </a>{" "}
                  does not define those tags; gittr and the bridge do. File/git
                  access is still enforced via{" "}
                  <code className="bg-blue-900/50 px-1 rounded">
                    maintainers
                  </code>{" "}
                  + bridge ACL.
                </p>
                <ul className="text-sm text-blue-100 space-y-1 list-disc list-inside ml-2 mb-3">
                  <li>
                    <strong>After Push:</strong> Save Private in Settings (or
                    Push to Nostr) so relays get{" "}
                    <code className="bg-blue-900/50 px-1 rounded">
                      public-read:false
                    </code>
                    . Clearing local data then reloads that status from Nostr.
                  </li>
                  <li>
                    <strong>Files Access:</strong> Files from private GitHub
                    repos require GitHub authentication. Connect your GitHub
                    account via OAuth (Settings → SSH Keys) to access private
                    repo files.
                  </li>
                  <li>
                    <strong>Other Clients:</strong> Other NIP-34 clients may
                    still list the announcement (name/description on relays).
                    gittr hides private repos from Explore/profile for
                    strangers; clone/file access stays blocked at the bridge for
                    non-maintainers.
                  </li>
                  <li>
                    <strong>Access Control:</strong> Only the owner and users in{" "}
                    <code className="bg-blue-900/50 px-1 rounded">
                      maintainers
                    </code>{" "}
                    / Contributors can open private repos. Enforced for
                    SSH/HTTPS git and file APIs.
                  </li>
                </ul>

                <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded">
                  <p className="text-sm font-semibold text-yellow-200 mb-2">
                    🔗 Identity Mapping & Access Control
                  </p>
                  <p className="text-sm text-yellow-100 mb-2">
                    <strong>How Access Works:</strong> Access to private
                    repositories is determined by your{" "}
                    <strong>Nostr pubkey (npub)</strong>, not your GitHub
                    username. This means:
                  </p>
                  <ul className="text-sm text-yellow-100 space-y-1 list-disc list-inside ml-2 mb-3">
                    <li>
                      <strong>Owner:</strong> The repository owner (the Nostr
                      pubkey that created/pushed the repo) has full access
                    </li>
                    <li>
                      <strong>Maintainers:</strong> Users whose Nostr pubkey
                      (npub) is explicitly added as a maintainer in Repository
                      Settings → Contributors
                    </li>
                    <li>
                      <strong>GitHub Identity:</strong> If you're a maintainer
                      on GitHub but haven't linked your Nostr identity, you
                      won't have access until the owner adds your npub
                    </li>
                  </ul>
                  <p className="text-sm text-yellow-100 mb-2">
                    <strong>Why This Matters:</strong> When importing from
                    GitHub, contributors are mapped to Nostr identities using:
                  </p>
                  <ol className="text-sm text-yellow-100 space-y-1 list-decimal list-inside ml-2 mb-3">
                    <li>
                      <strong>OAuth Mapping:</strong> If you've done GitHub
                      OAuth, your GitHub username is linked to your Nostr pubkey
                      in localStorage
                    </li>
                    <li>
                      <strong>NIP-39 Claims:</strong> If you've published a Kind
                      0 event with{" "}
                      <code className="bg-yellow-900/50 px-1 rounded">
                        ["i", "github:username"]
                      </code>{" "}
                      tags, your identity is claimed on Nostr
                    </li>
                    <li>
                      <strong>Manual Addition:</strong> The repository owner can
                      manually add maintainers by their npub in Repository
                      Settings
                    </li>
                  </ol>
                  <p className="text-sm text-yellow-200 font-semibold mb-1">
                    ⚠️ Common Issue: "Access Denied" for Maintainers
                  </p>
                  <p className="text-sm text-yellow-100 mb-2">
                    If you're a maintainer on GitHub but can't access a private
                    repo on gittr.space:
                  </p>
                  <ul className="text-sm text-yellow-100 space-y-1 list-disc list-inside ml-2">
                    <li>
                      The repository owner needs to add your{" "}
                      <strong>Nostr pubkey (npub)</strong> as a maintainer in
                      Repository Settings → Contributors
                    </li>
                    <li>
                      Your GitHub username alone isn't enough - you need your
                      npub explicitly added
                    </li>
                    <li>
                      This ensures security: only the owner can grant access,
                      and it's tied to your Nostr identity, not just GitHub
                    </li>
                  </ul>
                </div>

                <div className="mt-3 p-3 bg-purple-900/20 border border-purple-600/30 rounded">
                  <p className="text-sm font-semibold text-purple-200 mb-2">
                    💻 CLI & API Access
                  </p>
                  <p className="text-sm text-purple-100 mb-2">
                    When accessing private repositories via Git CLI or API:
                  </p>
                  <ul className="text-sm text-purple-100 space-y-1 list-disc list-inside ml-2 mb-2">
                    <li>
                      <strong>Git Clone:</strong> Requires SSH keys configured
                      in Settings → SSH Keys. The bridge checks your pubkey
                      against the repository's maintainers list.
                    </li>
                    <li>
                      <strong>Error Message:</strong> If access is denied,
                      you'll see:{" "}
                      <code className="bg-purple-900/50 px-1 rounded">
                        fatal: permission denied for read operation
                      </code>{" "}
                      with hints on how to get access.
                    </li>
                    <li>
                      <strong>API Endpoints:</strong> Private repo endpoints
                      gracefully return null/404 for unauthorized users (no
                      errors thrown).
                    </li>
                  </ul>
                  <p className="text-sm text-purple-100">
                    <strong>Note:</strong> The same access control applies - you
                    need your npub added as a maintainer by the owner,
                    regardless of whether you access via web UI, CLI, or API.
                  </p>
                </div>
              </HelpSubTopic>

              <HelpSubTopic title={<>4 MB import limit</>}>
                <p>
                  Next.js API routes hard-cap responses at ~4 MB. Large repos
                  (releases/binaries) may fail with “Repository is too large”.
                  Trim heavy artifacts or import a slimmer subset.
                </p>
              </HelpSubTopic>
            </HelpTopic>
          </div>
        </HelpSection>

        {/* Git Operations */}
        <HelpSection
          id="git-operations"
          title={
            <>
              <Code className="h-6 w-6 text-green-400" />
              Git Operations
            </>
          }
        >
          <div className="space-y-2">
            <HelpTopic title={<>Clone a Repository</>}>
              <p>
                gittr.space repositories support multiple clone URL formats:
              </p>

              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-green-400 mb-1">
                    Option A: SSH (Standard Git - Recommended)
                  </p>
                  <code className="block bg-[#0a0d11] p-2 rounded text-sm">
                    git clone git@gittr.space:npub1.../repo-name.git
                  </code>
                  <p className="mt-1 text-xs text-gray-400">
                    Requires SSH keys (Settings → SSH Keys). Works out of the
                    box with any Git client.
                  </p>
                </div>

                <div id="grasp" className="scroll-mt-24">
                  <p className="text-sm font-semibold text-blue-300 mb-1">
                    Option B: HTTPS (GRASP git servers)
                  </p>
                  <code className="block bg-[#0a0d11] p-2 rounded text-sm">
                    git clone
                    https://git.gittr.space/&lt;owner-pubkey&gt;/repo-name.git
                  </code>
                  <p className="mt-1 text-xs text-gray-400">
                    Read-only clones from our public mirrors (git.gittr.space,
                    gitnostr.com, relay.ngit.dev, ngit-relay.nostrver.se, ...).
                    Great for CI/CD or quick testing.
                  </p>
                </div>

                <div>
                  <p className="text-sm font-semibold text-purple-400 mb-1">
                    Option C: nostr:// Protocol (Ecosystem Standard)
                  </p>
                  <code className="block bg-[#0a0d11] p-2 rounded text-sm">
                    git clone nostr://yourname@git.gittr.space/repo-name
                  </code>
                  <p className="mt-1 text-xs text-gray-400">
                    Requires{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      git-remote-nostr
                    </code>
                    . This helper translates{" "}
                    <code className="bg-gray-800 px-1 rounded">nostr://</code>{" "}
                    URLs into standard Git fetches and is used by other NIP-34
                    clients.
                  </p>
                  <div className="mt-2 text-[11px] text-gray-300 bg-[#0f172a] border border-purple-900/40 rounded p-2 space-y-1">
                    <p className="font-semibold text-purple-300">
                      Install git-remote-nostr
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>
                        macOS/Linux:{" "}
                        <code className="bg-gray-900 px-1 rounded">
                          pip install git-remote-nostr
                        </code>{" "}
                        (Python 3.10+)
                      </li>
                      <li>
                        or build from source:{" "}
                        <a
                          className="text-purple-300 underline"
                          target="_blank"
                          rel="noreferrer"
                          href="https://github.com/aljazceru/git-remote-nostr"
                        >
                          github.com/aljazceru/git-remote-nostr
                        </a>
                      </li>
                      <li>
                        Add to PATH so Git can find the helper (verify with{" "}
                        <code className="bg-gray-900 px-1 rounded">
                          which git-remote-nostr
                        </code>
                        )
                      </li>
                    </ul>
                    <p className="mt-2 font-semibold text-purple-300">
                      How it works:
                    </p>
                    <ul className="list-disc list-inside space-y-1 mt-1">
                      <li>
                        <strong>With SSH keys</strong> (added in Settings → SSH
                        Keys): Automatically uses SSH for push/pull operations
                      </li>
                      <li>
                        <strong>Without SSH keys</strong>: Falls back to HTTPS
                        (read-only or with credentials)
                      </li>
                    </ul>
                    <p className="mt-2">
                      Once installed,{" "}
                      <code className="bg-gray-900 px-1 rounded">
                        git clone nostr://…
                      </code>{" "}
                      works with or without SSH keys - git-remote-nostr
                      automatically chooses the best option.
                    </p>
                  </div>
                </div>
              </div>

              <p className="mt-3 text-sm text-gray-400">
                SSH, HTTPS, and nostr:// clone URLs all ship inside every NIP-34
                repository event. Pick whichever matches your workflow.
              </p>
            </HelpTopic>

            <HelpTopic title={<>Browsing files on the Code tab</>}>
              <p className="text-sm text-gray-300 mb-2">
                NIP-34 events carry <strong>metadata</strong> (name,
                description,
                <code className="bg-gray-800 px-1 rounded">clone[]</code> URLs)
                — not the full file tree. gittr loads the tree from git servers
                and our bridge mirror.
              </p>
              <ol className="text-sm text-gray-300 list-decimal list-inside space-y-1 ml-1">
                <li>Cache / small embedded files in the event (legacy)</li>
                <li>
                  GitHub / GitLab / Codeberg when a{" "}
                  <code className="bg-gray-800 px-1 rounded">source</code> or
                  GitHub clone URL exists
                </li>
                <li>
                  For each GRASP HTTPS URL in{" "}
                  <code className="bg-gray-800 px-1 rounded">clone[]</code> (in
                  parallel): read our on-disk mirror, or shallow-clone that URL
                  directly, or mirror it onto gittr then read
                </li>
              </ol>
              <p className="mt-3 text-xs text-gray-400">
                If one mirror is down (502) but another works (e.g.{" "}
                <code className="bg-gray-800 px-1 rounded">relay.ngit.dev</code>
                ), you still get files from the working URL. The status chip on
                the repo shows ✓/✗ per source.
              </p>
              <p className="mt-2 text-xs text-gray-400">
                <strong>Newest metadata:</strong> we use the latest kind 30617
                from relays. <strong>Newest commit across all mirrors:</strong>{" "}
                we currently show the first mirror that responds with a tree,
                not a full compare of every server&apos;s HEAD — see{" "}
                <a
                  href={GITTR_DOC_FILE_FETCHING}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  FILE_FETCHING_INSIGHTS.md
                </a>
                .
              </p>
            </HelpTopic>

            <div className="mt-6 space-y-3">
              <h4 className="text-sm font-semibold text-white uppercase tracking-wide">
                Supported Git Commands
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-200">
                <div className="bg-[#11161f] border border-gray-700 rounded p-3 space-y-1">
                  <p className="font-semibold text-white">Day-to-day</p>
                  <code className="block bg-black/40 p-1 rounded">
                    git pull / git fetch
                  </code>
                  <code className="block bg-black/40 p-1 rounded">
                    git checkout &lt;branch&gt;
                  </code>
                  <code className="block bg-black/40 p-1 rounded">
                    git status
                  </code>
                  <code className="block bg-black/40 p-1 rounded">
                    git add / git commit
                  </code>
                </div>
                <div className="bg-[#11161f] border border-gray-700 rounded p-3 space-y-2">
                  <p className="font-semibold text-white">Publishing</p>
                  <p className="text-sm text-gray-200">
                    Use the <strong>Push to Nostr</strong> button in the repo
                    UI. We publish the NIP‑34 event and automatically sync your
                    repo to our git bridge so other clients can clone it
                    immediately.
                  </p>
                  <p className="text-[11px] text-gray-400">
                    CLI fan? You can still run{" "}
                    <code className="bg-black/40 px-1 rounded">
                      git push origin main
                    </code>
                    ; it hits the same bridge endpoint.
                  </p>
                </div>
                <div className="bg-[#11161f] border border-gray-700 rounded p-3 space-y-1">
                  <p className="font-semibold text-white">Branches & Tags</p>
                  <code className="block bg-black/40 p-1 rounded">
                    git branch -a / git switch -c
                  </code>
                  <code className="block bg-black/40 p-1 rounded">
                    git tag v1.2.3
                  </code>
                  <p className="text-[11px] text-gray-400">
                    Releases and tags show up instantly in the UI.
                  </p>
                </div>
                <div className="bg-[#11161f] border border-gray-700 rounded p-3 space-y-1">
                  <p className="font-semibold text-white">Troubleshooting</p>
                  <code className="block bg-black/40 p-1 rounded">
                    git remote -v
                  </code>
                  <code className="block bg-black/40 p-1 rounded">
                    git config --list
                  </code>
                  <code className="block bg-black/40 p-1 rounded">
                    git log --oneline
                  </code>
                </div>
              </div>
            </div>

            <HelpTopic id="push-to-nostr" title={<>Push to Nostr</>}>
              <p>
                After making local changes, click "Push to Nostr" in your
                repository settings to publish updates.
              </p>
              <p className="mt-2 text-sm text-gray-400">
                We sign the NIP‑34 event, publish it to your relays, and sync
                the Git repo to git.gittr.space automatically. Only small
                metadata files live inside the Nostr event; the real Git objects
                stay on the bridge.
              </p>
              <p className="mt-2 text-xs text-gray-400">
                If you see "Local changes are not visible in other clients yet",
                push to Nostr to publish those edits to relays.
              </p>
              <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm text-blue-200 font-semibold mb-1">
                  📦 File Content During Push
                </p>
                <p className="text-sm text-blue-100 mb-2">
                  Files are sourced from your browser's localStorage (from
                  create/import workflow) or from the bridge API if missing. The
                  push process does NOT fetch files from external sources
                  (GitHub, GitLab, etc.).
                </p>
                <p className="text-xs text-blue-200">
                  <strong>If files are missing:</strong> Re-import the
                  repository to load all files into localStorage before pushing.
                </p>
              </div>

              <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded">
                <p className="text-sm text-yellow-200 font-semibold mb-1">
                  ⚡ Push Paywall (if enabled by repo owner)
                </p>
                <ul className="text-sm text-yellow-100 list-disc list-inside space-y-1 ml-2">
                  <li>
                    Repo owners must configure either{" "}
                    <strong>LNbits Invoice Key</strong> or{" "}
                    <strong>Blink API Key</strong> in Settings -&gt; Account
                    before enabling non-zero Push Cost.
                  </li>
                  <li>
                    If a repo has <strong>Push Cost (sats)</strong> above zero,
                    "Push to Nostr" first creates a payment invoice.
                  </li>
                  <li>
                    The UI shows a QR/BOLT11 invoice popup. Pay it with any
                    Lightning wallet, then retry push.
                  </li>
                  <li>
                    For SSH pushes, if authorization is missing/expired the
                    terminal may print a{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      pending invoice (BOLT11)
                    </code>{" "}
                    directly. Pay it, then run{" "}
                    <code className="bg-gray-800 px-1 rounded">git push</code>{" "}
                    again.
                  </li>
                  <li>
                    Each paid authorization is <strong>single-use</strong>: one
                    successful bridge push consumes it. Unused authorization
                    expires after a short time.
                  </li>
                </ul>
              </div>

              <HelpSubTopic title={<>Common push errors</>}>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <code className="bg-gray-800 px-1 rounded">
                      Push payment required
                    </code>{" "}
                    — pay the invoice, then retry.
                  </li>
                  <li>
                    <code className="bg-gray-800 px-1 rounded">
                      push payment authorization expired
                    </code>{" "}
                    — create/pay a fresh invoice in the web UI, then{" "}
                    <code className="bg-gray-800 px-1 rounded">git push</code>{" "}
                    again.
                  </li>
                </ul>
              </HelpSubTopic>
            </HelpTopic>

            <HelpTopic id="ssh-keys" title={<>SSH Keys</>}>
              <p>
                Manage your SSH keys in Settings → SSH Keys. You'll need these
                for Git operations over SSH.
              </p>
            </HelpTopic>

            <div className="mt-4 pt-4 border-t border-gray-700 space-y-2">
              <p className="text-sm text-gray-400 mb-2">
                For complete documentation on SSH and Git operations:
              </p>
              <a
                href={GITTR_DOC_SSH_GIT}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline text-sm block"
              >
                📖 SSH &amp; Git Access Guide (gittr) →
              </a>
              <a
                href={GITTR_DOC_GITNOSTR_SSH}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline text-sm block"
              >
                📖 gitnostr bridge SSH guide →
              </a>
              <a
                href={GITTR_DOC_GITNOSTR_ARCHITECTURE}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline text-sm block"
              >
                📖 gitnostr infrastructure (no git hook — SSH + relays) →
              </a>
            </div>
          </div>
        </HelpSection>

        {/* Code Snippets */}
        <HelpSection
          id="code-snippets"
          title={
            <>
              <Code className="h-6 w-6 text-green-400" />
              Code Snippets (NIP-C0)
            </>
          }
        >
          <div className="space-y-2">
            <p className="text-sm">
              Select code in any file viewer to share it as a standalone snippet
              on Nostr. The action bar appears near your selection with options
              to copy a permalink or share as a snippet.
            </p>
            <p className="text-sm text-gray-400">
              <strong>Markdown anchors:</strong> In Markdown preview, headings
              show a link icon on hover. Click it to copy a direct heading link
              and update the URL hash for easy sharing.
            </p>
            <p className="text-sm text-gray-400">
              <strong>Mobile-friendly:</strong> Line numbers are hidden on
              mobile devices to avoid alignment issues, but all functionality is
              preserved. Code lines remain fully clickable for selection.
            </p>
            <HelpTopic title={<>Share Code Snippets</>}>
              <p>
                Share code snippets from your repositories as standalone,
                discoverable events on Nostr.
              </p>

              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-green-400 mb-1">
                    How to Share:
                  </p>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300 ml-2">
                    <li>Open any file in a repository</li>
                    <li>
                      Select the code lines you want to share (click to select,
                      Shift+click to extend)
                    </li>
                    <li>
                      Click the{" "}
                      <strong className="text-green-400">
                        "Share as snippet"
                      </strong>{" "}
                      button that appears
                    </li>
                    <li>Optionally add a description</li>
                    <li>
                      Click{" "}
                      <strong className="text-green-400">
                        "Share to Nostr"
                      </strong>
                    </li>
                  </ol>
                </div>

                <div>
                  <p className="text-sm font-semibold text-purple-400 mb-1">
                    What Gets Shared:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-300 ml-2">
                    <li>The selected code (with syntax highlighting)</li>
                    <li>Language and file extension (auto-detected)</li>
                    <li>Optional description</li>
                    <li>Link back to source repository (NIP-34 format)</li>
                  </ul>
                </div>
              </div>
            </HelpTopic>

            <HelpTopic title={<>Using Snippets in Comments</>}>
              <p>
                Reference code snippets in issue and PR comments. Snippets will
                appear inline with syntax highlighting.
              </p>

              <div className="mt-3 p-3 bg-purple-900/20 border border-purple-600/50 rounded">
                <p className="text-purple-200 font-semibold mb-2">
                  💡 How it works:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-purple-200/90 ml-2">
                  <li>
                    Share a code snippet using the "Share as snippet" button
                  </li>
                  <li>Copy the snippet event ID (shown after sharing)</li>
                  <li>
                    Paste the event ID in a comment (as{" "}
                    <code className="text-purple-300">nostr:note1...</code> or
                    hex format)
                  </li>
                  <li>
                    The snippet will automatically render inline with syntax
                    highlighting
                  </li>
                </ol>
              </div>
            </HelpTopic>

            <HelpTopic title={<>Snippet Features</>}>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-300 ml-2">
                <li>
                  <strong>Syntax Highlighting:</strong> Code is displayed with
                  proper formatting
                </li>
                <li>
                  <strong>Copy Code:</strong> One-click copy button
                </li>
                <li>
                  <strong>Download:</strong> Download snippet as a file
                </li>
                <li>
                  <strong>Repository Link:</strong> Click to view the source
                  repository
                </li>
                <li>
                  <strong>Discoverable:</strong> Snippets are searchable across
                  the Nostr network
                </li>
              </ul>
            </HelpTopic>

            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-sm text-gray-400 mb-2">
                Learn more about NIP-C0:
              </p>
              <a
                href={SCHEMATA_NIP_C0}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline text-sm"
              >
                📖 NIP-C0 on gittr schemata →
              </a>
            </div>
          </div>
        </HelpSection>

        {/* Payments & Bounties */}
        <HelpSection
          id="payments"
          title={
            <>
              <Coins className="h-6 w-6 text-yellow-400" />
              Payments & Bounties
            </>
          }
        >
          <div className="space-y-2">
            <HelpTopic
              title={
                <>
                  <Zap className="h-5 w-5 text-yellow-400" />
                  Zaps
                </>
              }
            >
              <p>
                Zap a repository to tip the owner (and optionally split among
                contributors). <strong>Owner only</strong> resolves where the
                invoice is paid <em>to</em> using the priority below. When the
                LNURL-pay endpoint supports{" "}
                <a
                  href={SCHEMATA_NIP57}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  NIP-57
                </a>
                , gittr requests a real zap invoice. <strong>Split</strong> mode
                mints the invoice from <strong>your</strong> LNbits wallet (repo
                payment config first, then Settings → Account) plus the
                SplitPayments extension — it does not rely on Nostr zap receipts
                for routing.
              </p>

              <div className="mt-4 overflow-x-auto rounded border border-slate-600">
                <table className="w-full min-w-[640px] text-left text-sm text-gray-300">
                  <thead className="bg-slate-800/80 text-slate-100">
                    <tr>
                      <th className="p-3 font-semibold">Flow</th>
                      <th className="p-3 font-semibold">Payer (sender)</th>
                      <th className="p-3 font-semibold">Recipient / repo</th>
                      <th className="p-3 font-semibold">How gittr confirms</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    <tr className="bg-slate-900/40">
                      <td className="p-3 align-top font-medium text-white">
                        Repo zap — Owner only
                      </td>
                      <td className="p-3 align-top">
                        NIP-07 extension to sign a zap request when NIP-57 is
                        available; any Lightning wallet to pay the invoice. Your{" "}
                        <strong>LNbits / NWC send</strong> in Settings → Account
                        is only for polling when gittr issued the invoice
                        through the fallback server path.
                      </td>
                      <td className="p-3 align-top">
                        <strong>Receive address priority:</strong> (1) owner
                        Nostr kind 0{" "}
                        <code className="text-gray-400">lud16</code> /{" "}
                        <code className="text-gray-400">lnurl</code> / NWC
                        receive, (2) if <em>you</em> are that owner, your
                        Settings → Account receive fields, (3) else Repo →
                        Payment configuration receive fields. LNURL must
                        advertise{" "}
                        <code className="text-gray-400">allowsNostr</code> for
                        the NIP-57 path.
                      </td>
                      <td className="p-3 align-top">
                        <strong>NIP-57:</strong> the page does not auto-detect
                        your wallet; a kind 9735 receipt may appear in{" "}
                        <strong>Your Zaps</strong> after relays gossip it.{" "}
                        <strong>Fallback invoice</strong> (no NIP-57): same
                        modal notice; LNbits keys in <em>your</em> account may
                        allow polling when gittr created the invoice
                        server-side.
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 align-top font-medium text-white">
                        Repo zap — Split
                      </td>
                      <td className="p-3 align-top">
                        <strong>Send wallet priority:</strong> (1) Repo →
                        Payment configuration LNbits URL + admin key if set, (2)
                        otherwise Settings → Account. SplitPayments targets in
                        that LNbits wallet must match contributor Lightning
                        addresses.
                      </td>
                      <td className="p-3 align-top">
                        Each included contributor needs a discoverable Lightning
                        address (Nostr profile or linked identity).
                      </td>
                      <td className="p-3 align-top">
                        LNbits invoice / wallet state — designed for reliable
                        server-side settlement, not Nostr gossip latency.
                      </td>
                    </tr>
                    <tr className="bg-slate-900/40">
                      <td className="p-3 align-top font-medium text-white">
                        Bounties
                      </td>
                      <td className="p-3 align-top">
                        Bounty creator: <strong>LNbits URL + admin key</strong>{" "}
                        in Settings → Account (creates withdraw links from that
                        wallet).
                      </td>
                      <td className="p-3 align-top">
                        PR author: Lightning address on their Nostr profile for
                        claim payout.
                      </td>
                      <td className="p-3 align-top">
                        LNbits withdraw link lifecycle (reserve, release, claim)
                        — must stay fast and auditable on the server.
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 align-top font-medium text-white">
                        Pay-to-merge / push paywall
                      </td>
                      <td className="p-3 align-top">
                        Payer uses the shown invoice; optional NWC / WebLN from
                        Settings → Account.
                      </td>
                      <td className="p-3 align-top">
                        Repo owner: keys under{" "}
                        <strong>Repo → Payment configuration</strong> (and/or
                        global account keys per push flow) so gittr / the bridge
                        can verify settlement — see setup docs for the exact key
                        types.
                      </td>
                      <td className="p-3 align-top">
                        Server checks invoice / push policy — not NIP-57
                        receipts.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-sm text-slate-400">
                Rows above describe <strong>what each flow needs</strong>, not
                every optional shortcut. <strong>Bounty creation</strong> always
                uses the bounty creator&apos;s keys from{" "}
                <strong>Settings → Account</strong> (not the repo&apos;s LNbits
                send configuration).
              </p>

              <div className="mt-3 p-3 bg-purple-900/20 border border-purple-600/50 rounded">
                <p className="text-purple-200 font-semibold mb-2">
                  💬 Payment Messages:
                </p>
                <p className="text-sm text-purple-200/90">
                  All zaps and bounties automatically include a payment message
                  with your username, "via gittr.space", and bolt emojis (⚡⚡).
                  This helps recipients identify where the payment came from.
                  The message format is:{" "}
                  <code className="text-purple-300">
                    {"{username} via gittr.space ⚡⚡"}
                  </code>{" "}
                  (max 160 characters).
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm text-purple-200/90 mt-2 ml-4">
                  <li>
                    <strong>Zaps:</strong> The message is included in the
                    invoice comment field (visible to the recipient)
                  </li>
                  <li>
                    <strong>Bounties:</strong> The message is included in the
                    withdraw link title (visible when claiming the bounty)
                  </li>
                  <li>
                    Your username is automatically fetched from your Nostr
                    profile (Kind 0 metadata)
                  </li>
                </ul>
              </div>
            </HelpTopic>

            <HelpTopic id="bounties" title={<>Bounties</>}>
              <p>
                Anyone can fund issues with bounties to incentivize
                contributions. Bounties use LNURL-withdraw links created from
                the bounty creator's LNbits wallet. The funds are reserved in
                the creator's wallet and will be deducted when the PR author
                claims the withdraw link.
              </p>

              <HelpSubTopic title={<>Requirements</>}>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>Creator:</strong> LNbits sending wallet in Settings
                    → Account, with balance until claim
                  </li>
                  <li>
                    <strong>PR author:</strong> Nostr pubkey + Lightning address
                    (<code className="bg-gray-800 px-1 rounded">lud16</code> /{" "}
                    <code className="bg-gray-800 px-1 rounded">lnurl</code>) in
                    Kind 0
                  </li>
                </ul>
              </HelpSubTopic>

              <HelpSubTopic title={<>Bounty flow (steps)</>}>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>
                    Create bounty on an issue (prompts for LNbits if missing)
                  </li>
                  <li>
                    LNURL-withdraw link reserves funds in the creator wallet
                  </li>
                  <li>Developer opens a PR linked to the issue</li>
                  <li>
                    Repo owner merges → withdraw link released to PR author
                  </li>
                  <li>
                    PR author claims → sats leave creator wallet to their
                    Lightning address
                  </li>
                  <li>
                    Issue closed without PR → withdraw link deleted, bounty
                    cancelled
                  </li>
                </ol>
              </HelpSubTopic>

              <HelpSubTopic title={<>Protection & trust model</>}>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    Linked PR blocks bounty deletion even if the issue closes
                  </li>
                  <li>
                    Merging attests the fix — only create bounties on repos you
                    trust
                  </li>
                  <li>
                    Closed without PR cancels the bounty; creator is notified
                  </li>
                </ul>
              </HelpSubTopic>

              <HelpSubTopic title={<>Flow diagram</>}>
                <div className="overflow-x-auto">
                  <div
                    ref={mermaidRef}
                    className="min-h-[320px] flex items-center justify-center w-full"
                  ></div>
                </div>
              </HelpSubTopic>

              <HelpSubTopic title={<>Statuses & key points</>}>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <span className="text-yellow-400">Pending</span> /
                    <span className="text-green-400"> Paid</span> /
                    <span className="text-purple-400"> Released</span> /
                    <span className="text-red-400"> Cancelled</span> /
                    <span className="text-gray-400"> Offline</span>
                  </li>
                  <li>
                    Funds stay in the creator wallet until claim (withdraw
                    links, not instant send)
                  </li>
                  <li>
                    Claim needs the PR author&apos;s Lightning address on Nostr
                  </li>
                </ul>
              </HelpSubTopic>
            </HelpTopic>

            <HelpTopic title={<>Bounty Hunt</>}>
              <p>
                Visit the{" "}
                <Link
                  href="/bounty-hunt"
                  className="text-yellow-400 hover:text-yellow-300"
                >
                  Bounty Hunt
                </Link>{" "}
                page to discover funded issues across all repositories.
              </p>
            </HelpTopic>
          </div>
        </HelpSection>

        {/* Notifications */}
        <HelpSection
          id="notifications"
          title={
            <>
              <Bell className="h-6 w-6 text-cyan-400" />
              Notifications
            </>
          }
        >
          <div className="space-y-2">
            <HelpTopic title={<>Configure Notifications</>}>
              <p>Go to Settings → Notifications to set up:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li>
                  <strong>Nostr DMs</strong> - Receive encrypted direct messages
                  on Nostr
                </li>
                <li>
                  <strong>Telegram</strong> - Get notifications via Telegram
                  DMs. Configure your Telegram User ID to receive private
                  notifications for PRs, issues, and bounties.
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">
                Bounty announcements are also posted to the public{" "}
                <a
                  href="https://t.me/gittrspace"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300"
                >
                  @gittrspace
                </a>{" "}
                channel.
              </p>
            </HelpTopic>

            <HelpTopic title={<>Notification Events</>}>
              <p>You can enable/disable notifications for:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                <li>
                  <strong>New issue in watched repos</strong> - When someone
                  opens an issue in a repository you're watching
                </li>
                <li>
                  <strong>Comments on issues I opened/participate</strong> -
                  When someone comments on an issue you created or are assigned
                  to
                </li>
                <li>
                  <strong>New pull request in watched repos</strong> - When
                  someone opens a PR in a repository you're watching
                </li>
                <li>
                  <strong>Reviews requested or comments on my PRs</strong> -
                  When someone requests your review or comments on your PR
                </li>
                <li>
                  <strong>My PR merged</strong> - When your pull request is
                  merged
                </li>
                <li>
                  <strong>I am @mentioned</strong> - When someone mentions you
                  in a comment or description
                </li>
                <li>
                  <strong>My Bounties</strong> - When a bounty is funded on an
                  issue you created (you'll be notified about the bounty amount)
                </li>
                <li>
                  <strong>Bounty released to me</strong> - When a bounty
                  withdraw link is released to you after a PR you created is
                  merged
                </li>
              </ul>
              <p className="mt-3 text-sm text-gray-400">
                <strong>Default Settings:</strong> Most notifications are
                disabled by default to reduce noise. The recommended settings
                (enabled by default) are: New issues, Issue comments, New PRs,
                PR reviews, PR merges, Mentions, My Bounties, and Bounty
                releases.
              </p>
              <p className="mt-2 text-sm text-gray-400">
                <strong>Important:</strong> Changes to notification preferences
                are not active until you click "SAVE NOW". Make sure to save
                your preferences after making changes.
              </p>
            </HelpTopic>

            <HelpTopic title={<>Bounty Notifications</>}>
              <p>Bounty notifications are sent to:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2 text-sm">
                <li>
                  <strong>Issue Owner (My Bounties):</strong> When someone funds
                  a bounty on your issue, you'll receive a notification via
                  Nostr DM and/or Telegram (if enabled) with the bounty amount
                  and issue details.
                </li>
                <li>
                  <strong>PR Author (Bounty released to me):</strong> When a PR
                  you created is merged and linked to an issue with a bounty,
                  you'll receive a notification that the bounty withdraw link
                  has been released to you. The notification includes the bounty
                  amount and instructions on how to claim it.
                </li>
                <li>
                  <strong>Bounty Creator (Bounty cancelled):</strong> When an
                  issue with your bounty is closed without a PR, you'll receive
                  a notification that the bounty was cancelled and the withdraw
                  link was deleted. This helps you know that your funds are no
                  longer reserved.
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">
                Bounty announcements are also automatically posted to the public{" "}
                <a
                  href="https://t.me/gittrspace"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300"
                >
                  @gittrspace
                </a>{" "}
                Telegram channel, regardless of your notification preferences.
              </p>
            </HelpTopic>
          </div>
        </HelpSection>

        {/* Collaboration */}
        <HelpSection id="collaboration" title={<>Collaboration</>}>
          <div className="space-y-2">
            <HelpTopic title={<>Pull Requests</>}>
              <p>
                Create PRs to propose changes. Reviewers can approve, request
                changes, or merge PRs.
              </p>

              <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm font-semibold text-blue-200 mb-2">
                  📋 How PRs Are Organized
                </p>
                <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                  <li>
                    <strong>Sorted by creation time:</strong> PRs are displayed
                    with the newest first, regardless of status changes
                  </li>
                  <li>
                    <strong>Aggregated from Nostr:</strong> PRs created by
                    anyone (locally or on other clients) appear in the list
                    automatically
                  </li>
                  <li>
                    <strong>Status tracking:</strong> Status changes (open →
                    merged/closed) don't affect the chronological order
                  </li>
                  <li>
                    <strong>Real-time updates:</strong> New PRs and status
                    changes from Nostr relays appear automatically
                  </li>
                </ul>
              </div>
            </HelpTopic>

            <HelpTopic title={<>Issues</>}>
              <p>
                Track bugs, feature requests, and discussions. Add bounties to
                incentivize solutions.
              </p>

              <div className="mt-3 p-3 bg-green-900/20 border border-green-600/30 rounded">
                <p className="text-sm font-semibold text-green-200 mb-2">
                  📋 How Issues Are Organized
                </p>
                <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                  <li>
                    <strong>Sorted by creation time:</strong> Issues are
                    displayed with the newest first, regardless of status
                    changes
                  </li>
                  <li>
                    <strong>Aggregated from Nostr:</strong> Issues created by
                    anyone (locally or on other clients) appear in the list
                    automatically
                  </li>
                  <li>
                    <strong>Status tracking:</strong> Status changes (open →
                    closed) don't affect the chronological order
                  </li>
                  <li>
                    <strong>Real-time updates:</strong> New issues and status
                    changes from Nostr relays appear automatically
                  </li>
                </ul>
              </div>
            </HelpTopic>

            <HelpTopic title={<>Contributors</>}>
              <p>
                Link your GitHub profile in Settings to show your profile
                picture as a contributor icon.
              </p>
            </HelpTopic>
          </div>
        </HelpSection>

        {/* Security */}
        <HelpSection
          id="security"
          title={
            <>
              <Shield className="h-6 w-6 text-red-400" />
              Security & Privacy
            </>
          }
        >
          <div className="space-y-2">
            <HelpTopic title={<>Local Storage</>}>
              <p>
                All your data (repos, keys, settings) is stored locally in your
                browser. It never leaves your device unless you explicitly push
                to Nostr.
              </p>

              <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded">
                <p className="text-yellow-200 font-semibold mb-2">
                  ⚠️ Browser & Domain Isolation
                </p>
                <p className="text-sm text-gray-300 mb-2">
                  Your data is stored separately for each browser and domain:
                </p>
                <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                  <li>
                    <strong>Different browsers</strong> (Chrome, Brave, Firefox)
                    have separate storage
                  </li>
                  <li>
                    <strong>Different domains</strong> (localhost:3000 vs
                    gittr.space) have separate storage
                  </li>
                  <li>
                    Repos, PRs, Issues, and edits are{" "}
                    <strong>not shared</strong> between browsers/domains
                  </li>
                </ul>
                <p className="text-sm text-gray-300 mt-2">
                  <strong>If you're missing repos, PRs, or edits:</strong> They
                  might be in a different browser or on a different domain. Use
                  the{" "}
                  <Link
                    href="/explore"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    Repos
                  </Link>{" "}
                  page to see all repositories from Nostr (consistent across
                  browsers).
                </p>
              </div>
            </HelpTopic>

            <HelpTopic title={<>Encrypted Keys</>}>
              <p>
                Your Nostr private key and payment credentials are encrypted
                with a password you set. Enable encryption in Settings →
                Security.
              </p>
            </HelpTopic>

            <HelpTopic title={<>Public vs Private</>}>
              <p>
                Repositories default to public when pushed to Nostr. You can set
                them to private in repository settings.
              </p>
            </HelpTopic>
          </div>
        </HelpSection>

        {/* Additional Resources */}
        <HelpSection title={<>Additional Resources</>}>
          <div className="space-y-2">
            <HelpTopic title={<>Documentation</>}>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://gittr.space"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 flex items-center gap-2"
                  >
                    <Github className="h-4 w-4" />
                    gittr.space (live)
                  </a>
                </li>
                <li>
                  <a
                    href={GITTR_REPO_GITTR}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 flex items-center gap-2"
                  >
                    <Github className="h-4 w-4" />
                    gittr source repo
                  </a>
                </li>
                <li>
                  <Link
                    href="/settings/notifications"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    Notification Settings
                  </Link>
                </li>
                <li>
                  <Link
                    href="/settings/profile"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    Profile & Verified Identities
                  </Link>
                </li>
              </ul>
            </HelpTopic>

            <HelpTopic title={<>Need More Help?</>}>
              <p>
                If you have questions or hit issues, see the{" "}
                <a
                  href={GITTR_REPO_GITTR}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300"
                >
                  gittr
                </a>{" "}
                source repo, plus{" "}
                <a
                  href={GITTR_REPO_GITNOSTR}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300"
                >
                  gitnostr
                </a>{" "}
                and{" "}
                <a
                  href={GITTR_REPO_HELPER_TOOLS}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300"
                >
                  gittr-helper-tools
                </a>
                , and the{" "}
                <a
                  href={SCHEMATA_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300"
                >
                  Nostr schemata
                </a>{" "}
                reference for NIPs and kinds.
              </p>
            </HelpTopic>
          </div>
        </HelpSection>
      </div>
    </div>
  );
}
