"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

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
  GITTR_REPO_NSITE_GATEWAY,
  HZRD146_NSITE_GATEWAY,
  ZAPSTORE_ON_GITTR,
  ZAPSTORE_PUBLISH_DOCS,
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
import { SECURITY_AUDIT_UI_ENABLED } from "@/lib/security/audit-ui-flag";

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

  // Deep links from repo sidebar / TOC / homepage (e.g. /help#when-source-goes-offline)
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const scrollToHash = () => {
      const id = window.location.hash?.replace(/^#/, "");
      if (!id) return;
      openHelpHashTargets(id);
    };

    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    // Next client nav to /help#… sometimes skips hashchange; catch clicks on in-page anchors
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.(
        "a[href^='#']"
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      const id = href.startsWith("#") ? href.slice(1) : "";
      if (!id) return;
      // Let the browser update the hash, then open (hashchange may also fire)
      window.setTimeout(() => openHelpHashTargets(id), 0);
    };
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", scrollToHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // After async chunks (mermaid, etc.) settle, re-apply hash once more
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.location.hash?.replace(/^#/, "");
    if (!id) return;
    const t = window.setTimeout(() => openHelpHashTargets(id), 600);
    return () => window.clearTimeout(t);
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
          securityLevel: "antiscript",
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
            <strong className="text-white">Nostr Pages</strong> . How-to:{" "}
            <Link
              href="#publish-pages-apps"
              className="text-purple-400 hover:text-purple-300"
            >
              Publish Pages, Apps &amp; Releases
            </Link>
            .
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
            . Repo owners use the Code sidebar{" "}
            <strong className="text-white">Nostr Apps</strong> panel to list an
            Android app from a GitHub / Codeberg / GitLab{" "}
            <strong className="text-white">Release</strong> that has an{" "}
            <code className="text-purple-200">.apk</code> (Zapstore). Other
            binaries on that same tag can be linked as extra NIP-82 assets;
            files stay on the forge. Zapstore listing is optional and free — see{" "}
            <Link
              href="#publish-pages-apps"
              className="text-purple-400 hover:text-purple-300"
            >
              Publish Pages, Apps &amp; Releases
            </Link>
            .
          </li>
          <li>
            <strong className="text-white">Releases</strong> — The repo{" "}
            <strong className="text-white">Releases</strong> tab shows forge
            download assets when a GitHub/Codeberg/GitLab source is linked, and
            also NIP-82 / Blossom releases from Nostr (same family as{" "}
            <Link href="/apps" className="text-purple-400 hover:text-purple-300">
              /apps
            </Link>
            ). Creating or announcing a release is <em>not</em> the same as{" "}
            <Link
              href="#push-to-nostr"
              className="text-purple-400 hover:text-purple-300"
            >
              Push to Nostr
            </Link>
            . Details:{" "}
            <Link
              href="#releases"
              className="text-purple-400 hover:text-purple-300"
            >
              Releases &amp; where they live
            </Link>
            .
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
                href="#importing-repositories"
                className="text-purple-400 hover:text-purple-300"
              >
                Importing Repositories
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
                href="#when-source-goes-offline"
                className="text-green-400 hover:text-green-300"
              >
                When your git host goes dark
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
                href="#releases"
                className="text-green-400 hover:text-green-300"
              >
                Releases &amp; where they live
              </Link>
            </li>
            <li>
              •{" "}
              <Link
                href="#publish-pages-apps"
                className="text-green-400 hover:text-green-300"
              >
                Publish Pages, Apps &amp; Releases
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
                    <li>
                      You&apos;re taken to Upload — drag &amp; drop files or
                      folders, or use Choose files / Choose folder
                    </li>
                    <li>Or push via Git CLI if you prefer (see below)</li>
                    <li>
                      Reusing a name you deleted earlier is fine — gittr treats
                      the new live announcement as current (My Repositories /
                      Explore / profile catch up once the new Push is seen)
                    </li>
                  </ul>
                </HelpSubTopic>

                <HelpSubTopic title={<>Option 3: Bulk import from GitHub</>}>
                  <p>
                    Load a GitHub user/org list, then choose what to import.
                    Opening the bulk page does <strong>not</strong> import
                    anything until you fetch, select, and confirm.{" "}
                    <strong>GitHub only</strong> — GitLab / Codeberg / Gitea
                    need Option 1 with a full URL (one repo at a time).
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
                    <strong>Web UI:</strong> Open the repo → Upload (or land
                    there after Create empty). Drag &amp; drop files or whole
                    folders; nested paths like{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      src/app/page.tsx
                    </code>{" "}
                    are kept. Then Push to Nostr when ready.
                  </p>
                  <p className="mt-2 text-sm text-gray-400">
                    Upload first syncs your browser to the{" "}
                    <strong className="text-gray-300">published tip</strong>{" "}
                    (when you have no unpushed edits), then merges your new
                    files on top — so an older local cache cannot overwrite a
                    newer Nostr/bridge state. If you already have unpushed local
                    edits, upload merges into those instead (use Refresh from
                    gittr only if you want to discard them).
                  </p>
                  <p className="mt-2 text-sm text-gray-400">
                    If the Code tab already shows files from the network but
                    Upload / Push complains about nothing local, use{" "}
                    <strong className="text-gray-300">
                      Refresh from gittr
                    </strong>{" "}
                    once (sidebar) so your browser stores a copy. Upload then
                    merges your new files on top; Push publishes the combined
                    tree.
                  </p>
                  <p className="mt-2">
                    <strong>Git CLI:</strong> after creating an empty repo, you
                    can also push via Git:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>
                      <code className="bg-gray-800 px-1 rounded">
                        git clone
                        git@git.gittr.space:&lt;pubkey&gt;/&lt;repo&gt;.git
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
                  <strong>MCP or gn:</strong> Agents use{" "}
                  <code className="bg-gray-800 px-1 rounded">createRepo</code>{" "}
                  (HTTPS + nsec, no SSH). Operators can use{" "}
                  <code className="bg-gray-800 px-1 rounded">
                    gn repo create
                  </code>
                  . Same git host as the website.
                </li>
              </ul>
              <p className="text-sm text-gray-400 mb-3">
                All repos are stored locally in your browser and can be pushed
                to Nostr for public access.
                <strong className="text-yellow-400"> Tip:</strong> After Create
                empty, use Upload (files or folders, drag &amp; drop) or push
                via Git — then Push to Nostr for public access.
              </p>
              <div className="p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm font-semibold text-blue-200 mb-2">
                  📖 Complete Workflow for Empty Repositories
                </p>
                <p className="text-sm text-gray-300 mb-2">
                  After creating an empty repository (website, MCP{" "}
                  <code className="bg-gray-800 px-1 rounded">createRepo</code>,
                  or <code className="bg-gray-800 px-1 rounded">gn</code>
                  ):
                </p>
                <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside ml-2">
                  <li>
                    Pick a git door: <strong>SSH</strong> (laptop, like GitHub)
                    or <strong>HTTPS / MCP</strong> (agents — no SSH key)
                  </li>
                  <li>
                    For SSH only: publish your public key once (
                    <strong>Settings → SSH Keys</strong>, or{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      gn ssh-key add
                    </code>
                    ). The website is not in the SSH path after that.
                  </li>
                  <li>
                    Clone:{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      git clone
                      git@git.gittr.space:&lt;your-npub&gt;/&lt;repo-name&gt;.git
                    </code>{" "}
                    or HTTPS{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      https://git.gittr.space/&lt;hex&gt;/&lt;repo&gt;.git
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
                View, edit, and delete files or folders directly in the browser
                (owners: trash icon on each Code tree row, or Delete while a
                file is open). Deleting a folder marks it and everything inside
                for removal — the next Push to Nostr deletes it on the git host
                (GRASP / bridge), not just in this browser. Use the fuzzy file
                finder (Cmd/Ctrl+P) to quickly navigate large repositories.
              </p>
            </HelpTopic>

            <HelpTopic title={<>File Sources & NIP-34 Architecture</>}>
              <p>
                Files live on git hosts (GRASP /{" "}
                <a
                  href={GITTR_DOC_GITNOSTR_ARCHITECTURE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  gitnostr bridge
                </a>
                ), not inside Nostr events.{" "}
                <a
                  href={SCHEMATA_NIP34}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  NIP-34
                </a>{" "}
                announcements carry metadata and{" "}
                <code className="bg-black/40 px-1 rounded text-xs">
                  clone[]
                </code>{" "}
                URLs. The Code sidebar shows where the tree is loading from:
                bridge / GRASP, GitHub, GitLab, and so on. Legacy “embedded in
                the event” trees are rare.
              </p>
            </HelpTopic>

            <HelpTopic
              id="importing-repositories"
              title={<>Importing Repositories</>}
            >
              <p>
                Bring an existing remote into gittr, then{" "}
                <Link
                  href="#push-to-nostr"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  Push to Nostr
                </Link>{" "}
                so others can discover and clone it from GRASP / the bridge (not
                only from the original host). Details:{" "}
                <Link
                  href="#when-source-goes-offline"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  When your git host goes dark
                </Link>
                .
              </p>

              <ul className="list-disc list-inside space-y-2 ml-1 mt-3 text-sm">
                <li>
                  <strong className="text-white">GitHub</strong> — single repo
                  or bulk import. Linking GitHub via NIP-39 under Settings →
                  Profile matches GitHub usernames to npubs (contributor
                  pictures). It is not what makes you the gittr owner: importing
                  while logged in already does that. The purple{" "}
                  <strong className="text-white">owner</strong> pill on a
                  profile is “this npub announced the repo,” not “GitHub
                  confirmed.” Importing your own GitHub repo is still{" "}
                  <strong className="text-white">owner</strong>. The purple{" "}
                  <strong className="text-white">forked</strong> pill is only
                  for a real upstream parent (someone else’s repo on any
                  supported forge) or a gittr Fork — not “this has a forge URL.”
                </li>
                <li>
                  <strong className="text-white">
                    GitLab, Codeberg, Gitea / Forgejo, other HTTPS / git@ URLs
                  </strong>{" "}
                  — paste the full clone URL on{" "}
                  <Link
                    href="/new"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    Create repository
                  </Link>{" "}
                  (Option 1). The server runs a normal public{" "}
                  <code className="bg-blue-900/50 px-1 rounded">git clone</code>
                  . Bulk import is GitHub-only. Forgejo/Gitea (including
                  Codeberg and self-hosted) uses the same paste-URL import;
                  Issues, PRs, and Releases then refresh from{" "}
                  <code className="bg-blue-900/50 px-1 rounded">/api/v1</code>.
                  Nostr Pages and app announce work the same as for GitHub once
                  a Release exists on that forge.
                </li>
              </ul>

              <HelpSubTopic title={<>Three ways gittr talks to forges</>}>
                <p className="text-sm text-gray-300">
                  gittr does not treat every git website the same under the
                  hood. After you import, it refreshes metadata (fork parent,
                  stars, issues, pull requests, releases) using one of three API
                  families:
                </p>
                <div className="mt-3 p-3 bg-purple-900/20 border border-purple-600/50 rounded text-sm text-gray-300 space-y-3">
                  <div>
                    <p className="font-semibold text-purple-200">
                      GitHub API → github.com
                    </p>
                    <p className="mt-1 text-gray-400">
                      Bulk import, OAuth linking, and GitHub-specific metadata.
                      Uses GitHub&apos;s REST API (
                      <code className="bg-black/40 px-1 rounded text-xs">
                        /repos/…
                      </code>
                      ).
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-purple-200">
                      GitLab API → gitlab.com (and similar)
                    </p>
                    <p className="mt-1 text-gray-400">
                      Paste a GitLab clone URL on Create repository. gittr uses
                      GitLab&apos;s v4 API for fork parent lookup and tab
                      refresh. Self-hosted GitLab instances with the same API
                      shape work the same way.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-purple-200">
                      Gitea / Forgejo API (
                      <code className="bg-black/40 px-1 rounded text-xs">
                        /api/v1
                      </code>
                      ) → Codeberg, gitea.com, self-hosted Forgejo / Gitea
                    </p>
                    <p className="mt-1 text-gray-400">
                      <strong className="text-gray-300">Forgejo</strong> is
                      open-source forge software (a community fork of{" "}
                      <strong className="text-gray-300">Gitea</strong>).{" "}
                      <strong className="text-gray-300">Codeberg</strong> (
                      codeberg.org) is a popular public site that{" "}
                      <em>runs Forgejo</em> — not a separate product. They share
                      the same URL layout (
                      <code className="bg-black/40 px-1 rounded text-xs">
                        host/owner/repo
                      </code>
                      ) and the same REST API, so gittr handles Codeberg,
                      gitea.com, and your own Forgejo/Gitea server with one code
                      path. Import is always paste-URL +{" "}
                      <code className="bg-blue-900/50 px-1 rounded text-xs">
                        git clone
                      </code>
                      ; Issues, PRs, Releases, and fork badges then refresh from{" "}
                      <code className="bg-black/40 px-1 rounded text-xs">
                        /api/v1
                      </code>
                      .
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-gray-400">
                  In short: GitHub, GitLab, and Gitea/Forgejo are three
                  different &quot;languages&quot; gittr speaks. You still paste
                  one clone URL — gittr picks the right API from the hostname.
                </p>
              </HelpSubTopic>

              <HelpSubTopic title={<>Size limits</>}>
                <p>
                  <strong className="text-white">GitHub import</strong> (
                  <code className="bg-black/40 px-1 rounded text-xs">
                    /api/import
                  </code>
                  ) returns file <em>paths</em> and metadata, not file bodies.
                  If that JSON is still larger than ~4 MB (very large trees),
                  you get{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    Repository is too large
                  </code>{" "}
                  /{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    repo_too_large
                  </code>
                  . Import a smaller repo, or use a URL clone +{" "}
                  <Link
                    href="#push-to-nostr"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    Push to Nostr
                  </Link>{" "}
                  so the bridge holds the objects.
                </p>
                <p className="mt-2 text-sm text-gray-400">
                  Paste-URL imports (
                  <code className="bg-black/40 px-1 rounded text-xs">
                    /api/import-git
                  </code>
                  ) do not use that same 4 MB metadata cap. Huge binaries still
                  belong in git LFS / releases on a real git host, not in the
                  browser editor.
                </p>
              </HelpSubTopic>

              <HelpSubTopic title={<>Private repositories</>}>
                <p>
                  Privacy on gittr is tied to your{" "}
                  <strong className="text-white">Nostr pubkey</strong>, not your
                  GitHub username. Settings → Private publishes{" "}
                  <code className="bg-blue-900/50 px-1 rounded text-xs">
                    [&quot;public-read&quot;,&quot;false&quot;]
                  </code>{" "}
                  on kind 30617 (gittr extension; not core{" "}
                  <a
                    href={SCHEMATA_NIP34}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    NIP-34
                  </a>
                  ). After Push, listings and the bridge honor that.
                </p>
                <ul className="list-disc list-inside space-y-1 ml-1 mt-2 text-sm">
                  <li>
                    Only the owner and npubs listed under Settings →
                    Contributors /{" "}
                    <code className="bg-blue-900/50 px-1 rounded text-xs">
                      maintainers
                    </code>{" "}
                    can open private repos (web, SSH, HTTPS).
                  </li>
                  <li>
                    Being a GitHub maintainer is not enough until the owner adds
                    your npub (or you are mapped via OAuth / NIP-39).
                  </li>
                  <li>
                    Private GitHub <em>source</em> files may still need GitHub
                    OAuth (Settings → SSH Keys) while reading from GitHub
                    itself.
                  </li>
                  <li>
                    SSH denial looks like{" "}
                    <code className="bg-black/40 px-1 rounded text-xs">
                      permission denied for read operation
                    </code>
                    — ask the owner to add your npub.
                  </li>
                </ul>
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
                    git clone git@git.gittr.space:npub1.../repo-name.git
                  </code>
                  <p className="mt-1 text-xs text-gray-400">
                    For laptop Git, like GitHub. Publish your public key once
                    (Settings → SSH Keys, or{" "}
                    <code className="bg-gray-800 px-1 rounded">
                      gn ssh-key add
                    </code>
                    ). After that, clone/push never go through the website.
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
                    Same bare repo as SSH. Public clones work over HTTPS.{" "}
                    <strong>gittr-mcp</strong> pushes over HTTPS + a local nsec
                    (no SSH, no Amber). Authenticated HTTPS is not read-only.
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
                <strong>SSH / CLI vs Code tab:</strong>{" "}
                <code className="bg-gray-800 px-1 rounded">
                  git clone git@git.gittr.space:…
                </code>{" "}
                reads the same bridge bare repo the Code tab uses. The website
                additionally walks published{" "}
                <code className="bg-gray-800 px-1 rounded">clone[]</code> /
                <code className="bg-gray-800 px-1 rounded">source</code> URLs
                (forge first, then GRASP mirrors). File timestamps on the Code
                list come from the selected tip/branch on that mirror. Clone URL
                chips should list every pushable GRASP host from the event (not
                only git.gittr.space). After a clean Push with a forge{" "}
                <code className="bg-gray-800 px-1 rounded">source</code>, the
                tip should match the forge — not a new empty “Push from gittr”
                commit. Details:{" "}
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
                    Use <strong>Push to Nostr</strong> on the Code tab. Approve
                    with whatever you logged in with:{" "}
                    <strong>NIP-07</strong> extension,{" "}
                    <strong>NIP-46 remote signer</strong> (Amber / bunker), or
                    nsec. That publishes the NIP‑34 announcement to your relays
                    and, on gittr, tries to mirror the Git repo to{" "}
                    <code className="bg-black/40 px-1 rounded">
                      git.gittr.space
                    </code>{" "}
                    so clones here work. Imported repos still keep their
                    original forge (GitHub, etc.) as the source — the bridge is
                    a mirror, not the only copy.
                  </p>
                  <p className="text-[11px] text-gray-400">
                    CLI fan? You can still run{" "}
                    <code className="bg-black/40 px-1 rounded">
                      git push origin main
                    </code>{" "}
                    to a bridge remote; that updates the same gittr mirror.
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
                    Git tags are part of the repo history after you push them.
                    Downloadable release files live on the forge{" "}
                    <strong className="text-gray-300">Releases</strong> page —
                    see{" "}
                    <Link
                      href="#releases"
                      className="text-purple-400 hover:text-purple-300"
                    >
                      Releases &amp; where they live
                    </Link>
                    .
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
                After making local changes, click <strong>Push to Nostr</strong>{" "}
                on the Code tab (sidebar). Sign with{" "}
                <strong>NIP-07</strong>, <strong>Amber / NIP-46</strong> remote
                signer, or nsec — same login as Settings. Or use{" "}
                <strong>gittr-mcp</strong>{" "}
                <code className="bg-gray-800 px-1 rounded">
                  publishRepoAnnouncement
                </code>{" "}
                / <code className="bg-gray-800 px-1 rounded">createRepo</code>{" "}
                (same events, local nsec, no SSH).
              </p>
              <p className="mt-2 text-sm text-gray-400">
                Amber must stay open/unlocked on your phone. Push first opens
                sockets to Amber&apos;s bunker relays; if that fails, nothing is
                published. Hard-refresh once if a previous page load left those
                relays stuck, then try Push again.
              </p>
              <p className="mt-2 text-sm text-gray-400">
                That does two different things — and it does{" "}
                <strong className="text-gray-300">not</strong> create a forge
                Release, upload installers, or list the app on{" "}
                <Link
                  href="/apps"
                  className="text-purple-400 hover:text-purple-300"
                >
                  /apps
                </Link>
                . Those are separate, on-purpose steps (
                <Link
                  href="#releases"
                  className="text-purple-400 hover:text-purple-300"
                >
                  Releases
                </Link>
                ,{" "}
                <Link
                  href="#publish-pages-apps"
                  className="text-purple-400 hover:text-purple-300"
                >
                  Pages &amp; Apps
                </Link>
                ):
              </p>
              <ul className="mt-2 text-sm text-gray-400 list-disc list-inside space-y-1 ml-1">
                <li>
                  <strong className="text-gray-300">Announce</strong> — we sign
                  a NIP‑34 event (name, description, clone links, etc.) and
                  publish it to your relays. The event is mostly metadata, not
                  your full Git history.
                </li>
                <li>
                  <strong className="text-gray-300">Mirror (gittr)</strong> — we
                  also try to put a Git copy on{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    git.gittr.space
                  </code>{" "}
                  so people can clone from here. That usually works after Push,
                  but it is not guaranteed if the mirror step fails.
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">
                <strong className="text-gray-300">Imported repos:</strong> Push
                does <em>not</em> move your project off GitHub/GitLab/Codeberg.
                The forge stays the original (
                <code className="bg-black/40 px-1 rounded text-xs">source</code>
                ). gittr lists its bridge/GRASP URLs for Nostr clients and tries
                to mirror objects onto the bridge. Other GRASP hosts (e.g.{" "}
                <code className="bg-black/40 px-1 rounded text-xs">
                  relay.ngit.dev
                </code>
                ) may also appear in clone links if configured — those are extra
                mirrors/links, not “everything lives only on gittr.”
              </p>
              <p className="mt-2 text-xs text-gray-400">
                If you see &quot;Please repush on local edits&quot;, use Push to
                Nostr so relays (and the mirror attempt) get those edits. Import
                alone stays local until you Push. For repos that already live on
                the gittr bridge but not in this browser,{" "}
                <strong className="text-gray-300">Refresh from gittr</strong>{" "}
                (or just Upload — it will prepare a local copy) before Push.
              </p>
              <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                <p className="text-sm text-blue-200 font-semibold mb-1">
                  📦 Where files come from during Push
                </p>
                <p className="text-sm text-blue-100 mb-2">
                  If you already edited files in the browser, those local files
                  are uploaded to the bridge. For a clean import with no local
                  edits, the bridge often clones from the forge{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    source
                  </code>{" "}
                  URL instead.
                </p>
                <p className="text-xs text-blue-200">
                  <strong>If the tree looks empty after Push:</strong> Re-import
                  or open the repo so files load, then Push again — or{" "}
                  <code className="bg-black/40 px-1 rounded">git push</code> to
                  a bridge remote.
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

            <HelpTopic
              id="when-source-goes-offline"
              title={<>When your git host goes dark</>}
            >
              <p>
                Rough week for some self-hosted Git setups — here&apos;s the
                practical bit, no panic.
              </p>
              <p className="mt-2">
                A normal{" "}
                <code className="bg-black/40 px-1 rounded text-xs">
                  git clone
                </code>{" "}
                or gittr <strong>import</strong> only copies{" "}
                <strong>repo objects</strong> (commits, trees, blobs). It does{" "}
                <strong>not</strong> bring over Gitea&apos;s{" "}
                <code className="bg-black/40 px-1 rounded text-xs">
                  app.ini
                </code>
                , internal token, or planted service hooks. Those stay on the
                compromised or shut-down host. So code you already imported into
                gittr is not carrying that server compromise with it.
              </p>
              <p className="mt-2">
                What keeps the repo{" "}
                <strong>visible and cloneable online</strong> is an independent
                mirror: import (or clone) into gittr, then{" "}
                <Link
                  href="#push-to-nostr"
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  Push to Nostr
                </Link>
                . That publishes the announcement on relays and puts objects on
                GRASP / the bridge (
                <code className="bg-black/40 px-1 rounded text-xs">
                  git.gittr.space
                </code>{" "}
                and other{" "}
                <code className="bg-black/40 px-1 rounded text-xs">
                  clone[]
                </code>{" "}
                hosts). Others can keep discovering and cloning without the
                original forge.
              </p>
              <p className="mt-2 text-sm text-gray-400">
                Quick check: can someone still{" "}
                <code className="bg-black/40 px-1 rounded text-xs">
                  git clone
                </code>{" "}
                from a URL in your announcement{" "}
                <code className="bg-black/40 px-1 rounded text-xs">
                  clone[]
                </code>{" "}
                without the original host? If yes, that snapshot is fine. If
                every clone URL still points only at the dead host, finish a
                Push (or push to a GRASP remote) so the tree has somewhere else
                to live.
              </p>

              <div className="mt-4 overflow-x-auto rounded border border-slate-600">
                <table className="w-full min-w-[720px] text-left text-sm text-gray-300">
                  <thead className="bg-slate-800/80 text-slate-100">
                    <tr>
                      <th className="p-3 font-semibold">Path</th>
                      <th className="p-3 font-semibold">What is stored</th>
                      <th className="p-3 font-semibold">
                        If that host dies or gets taken down
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    <tr className="bg-slate-900/40">
                      <td className="p-3 align-top font-medium text-white">
                        gittr import, never Push to Nostr
                      </td>
                      <td className="p-3 align-top">
                        Mostly browser localStorage plus a pointer (
                        <code className="bg-black/40 px-1 rounded text-xs">
                          source
                        </code>
                        ) at the original forge. Objects are not the Gitea
                        server compromise.
                      </td>
                      <td className="p-3 align-top text-amber-200/90">
                        Not enough for others yet. Only your browser has the
                        files; Push so relays and GRASP can serve them.
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 align-top font-medium text-white">
                        gittr import + successful Push to Nostr
                      </td>
                      <td className="p-3 align-top">
                        Kind 30617 / 30618 on relays, and objects mirrored onto
                        the GRASP / bridge hosts listed in{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          clone[]
                        </code>{" "}
                        (for example{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          git.gittr.space
                        </code>
                        )
                      </td>
                      <td className="p-3 align-top text-emerald-200/90">
                        Safe for that snapshot and still discoverable. Others
                        clone from GRASP, not the original forge. If the old
                        host was compromised, rotate secrets that lived only
                        there (and any tokens you once committed inside the
                        repo).
                      </td>
                    </tr>
                    <tr className="bg-slate-900/40">
                      <td className="p-3 align-top font-medium text-white">
                        Forge Release assets (APK, AppImage, MSI, …)
                      </td>
                      <td className="p-3 align-top">
                        Binary files on GitHub / Codeberg / GitLab (or another
                        host). gittr&apos;s Releases tab mostly <em>lists</em>{" "}
                        those links; it does not store the installers.
                      </td>
                      <td className="p-3 align-top text-amber-200/90">
                        Download buttons that point at the dead forge break.
                        Code you already Push&apos;d to GRASP can still be
                        cloned — that is source, not the release installers. See{" "}
                        <Link
                          href="#releases"
                          className="underline hover:text-amber-50"
                        >
                          Releases &amp; where they live
                        </Link>
                        .
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 align-top font-medium text-white">
                        Nostr Apps announce (NIP-82 / Zapstore)
                      </td>
                      <td className="p-3 align-top">
                        Signed events on relays (app / release / asset). Asset{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          url
                        </code>{" "}
                        usually still points at the forge download. Listing
                        appears on{" "}
                        <Link
                          href="/apps"
                          className="text-purple-400 hover:text-purple-300"
                        >
                          /apps
                        </Link>{" "}
                        and your profile Apps section.
                      </td>
                      <td className="p-3 align-top text-amber-200/90">
                        The announce stays discoverable; the download may 404 if
                        the forge is gone. Hashes on the event do not replace a
                        live file unless you also host the blob elsewhere
                        (Blossom / CDN). Pages (kind 35128) are different —
                        those files are uploaded to Blossom.
                      </td>
                    </tr>
                    <tr className="bg-slate-900/40">
                      <td className="p-3 align-top font-medium text-white">
                        nak / git-remote-nostr announce with{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          clone
                        </code>{" "}
                        /{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          source
                        </code>{" "}
                        = original forge only
                      </td>
                      <td className="p-3 align-top">
                        Metadata on Nostr pointing at the original forge
                      </td>
                      <td className="p-3 align-top text-amber-200/90">
                        Not enough. The announcement stays; the tree is gone
                        when the forge is. Push objects to a GRASP remote (or
                        import + Push on gittr).
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 align-top font-medium text-white">
                        nak / git-remote-nostr that actually pushed to a GRASP
                        remote
                      </td>
                      <td className="p-3 align-top">
                        Objects on that GRASP host plus the announcement
                      </td>
                      <td className="p-3 align-top text-emerald-200/90">
                        Same idea as a good gittr push: independent mirror,
                        still findable.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-4 p-3 bg-blue-900/20 border border-blue-600/30 rounded space-y-2">
                <p className="text-sm text-blue-100">
                  <strong className="text-blue-50">What to do now</strong>
                </p>
                <ul className="list-disc list-inside text-sm text-blue-100 space-y-1.5">
                  <li>
                    <strong className="text-blue-50">
                      Source still reachable?
                    </strong>{" "}
                    Import it into gittr while you can (
                    <Link
                      href="#importing-repositories"
                      className="underline hover:text-blue-50"
                    >
                      Importing Repositories
                    </Link>
                    , or{" "}
                    <Link href="/new" className="underline hover:text-blue-50">
                      Create repository
                    </Link>{" "}
                    and paste the clone URL), then{" "}
                    <Link
                      href="#push-to-nostr"
                      className="underline hover:text-blue-50"
                    >
                      Push to Nostr
                    </Link>
                    .
                  </li>
                  <li>
                    <strong className="text-blue-50">
                      Only a local backup / disk copy left?
                    </strong>{" "}
                    Create a new repo from that tree on{" "}
                    <Link href="/new" className="underline hover:text-blue-50">
                      /new
                    </Link>
                    , then Push to Nostr so others can clone without the old
                    host.
                  </li>
                </ul>
                <p className="text-xs text-blue-200/80">
                  Looking for a Nostr mirror of a known forge repo (GitHub,
                  GitLab, Codeberg, Gitea, … — exact URL /{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    owner/repo
                  </code>
                  , not fuzzy name)? Use MCP{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    findReposBySource
                  </code>{" "}
                  or{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    GET /api/nostr/repos-by-github?source=https://…
                  </code>
                  — returns npub + gittr URL so you can reach them on Nostr
                  (profile / DM) when the forge is unreachable. Needs a Push to
                  Nostr announce that kept the{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    source
                  </code>{" "}
                  tag. Import / clone only copies repo objects (commits, trees,
                  blobs) — not the old forge&apos;s server config. After Push,
                  confirm a{" "}
                  <code className="bg-black/40 px-1 rounded text-xs">
                    clone[]
                  </code>{" "}
                  URL works without the original host. If you still run
                  self-hosted Gitea older than 1.27.1, patch that machine
                  separately:{" "}
                  <a
                    href="https://github.com/go-gitea/gitea/security/advisories/GHSA-6v53-hr58-556r"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-blue-100"
                  >
                    GHSA-6v53-hr58-556r
                  </a>
                  ,{" "}
                  <a
                    href="https://github.com/go-gitea/gitea/security/advisories/GHSA-rcr6-4jqh-j84m"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-blue-100"
                  >
                    GHSA-rcr6-4jqh-j84m
                  </a>
                  ,{" "}
                  <a
                    href="https://blog.gitea.com/release-of-1.27.1/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-blue-100"
                  >
                    Gitea 1.27.1
                  </a>
                  .
                </p>
              </div>
            </HelpTopic>

            <HelpTopic id="ssh-keys" title={<>SSH Keys</>}>
              <p>
                SSH keys are only for laptop{" "}
                <code className="bg-gray-800 px-1 rounded">
                  git@git.gittr.space
                </code>
                . They are Nostr kind <strong>52</strong> events the bridge
                copies into{" "}
                <code className="bg-gray-800 px-1 rounded">
                  authorized_keys
                </code>
                . The website is <strong>not</strong> in the SSH path after the
                key is registered.
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4 mt-2 text-sm text-gray-300">
                <li>
                  <strong>Optional UI:</strong> Settings → SSH Keys. Kind 52 is
                  signed with NIP-07, Amber / NIP-46 (bunker), or nsec — not
                  only a browser extension.
                </li>
                <li>
                  <strong>CLI, no UI:</strong>{" "}
                  <code className="bg-gray-800 px-1 rounded">
                    gn ssh-key add ~/.ssh/id_ed25519.pub
                  </code>
                </li>
                <li>
                  <strong>Agents:</strong> gittr-mcp uses HTTPS + nsec instead —
                  skip SSH entirely
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">
                Push to Nostr, issues, and PRs in the browser use your Nostr
                key, not SSH.
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
                  <strong>Telegram</strong> - Private DMs via{" "}
                  <a
                    href="https://t.me/gittrupdatebot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    @gittrupdatebot
                  </a>
                  : send <code>/start</code>, paste the User ID into Settings →
                  Notifications. No public channel post required. You can enable
                  Nostr and Telegram together.
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-400">
                <strong>Save now</strong> does two things: publishes your
                toggles as a kind{" "}
                <code className="bg-gray-800 px-1 rounded text-xs">30078</code>{" "}
                event (
                <code className="bg-gray-800 px-1 rounded text-xs">
                  d=gittr/notifications
                </code>
                ) so prefs sync across browsers, and registers delivery on the
                server (Telegram User ID stays off public relays). DMs always
                use the <strong>recipient&apos;s</strong> saved prefs — not
                whoever clicked in their own browser.
              </p>
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
                channel (announcements only — not used for auth).
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
                <strong>Defaults:</strong> collaboration (new issues, issue
                comments, PRs, reviews, merges, mentions, bounties) is{" "}
                <strong>on</strong>; stars / watches / zaps are off; security
                (CVE) alerts stay off until you opt in.
              </p>
              {SECURITY_AUDIT_UI_ENABLED && (
                <p className="mt-2 text-sm text-gray-400">
                  Dependency notices are listed under{" "}
                  <a
                    href="#security-alerts"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    Dependency notices (CVE)
                  </a>
                  .
                </p>
              )}
              <p className="mt-2 text-sm text-gray-400">
                <strong>Important:</strong> Changes to notification preferences
                are not active until you click &quot;SAVE NOW&quot;. Make sure
                to save your preferences after making changes.
              </p>
            </HelpTopic>

            {SECURITY_AUDIT_UI_ENABLED && (
              <HelpTopic
                id="security-alerts"
                title={
                  <>
                    Dependency notices (CVE) — calm by design, verify before
                    panic
                  </>
                }
              >
                <p>
                  Supply-chain attacks on git forges are a hot topic. gittr
                  scans the dependencies of every repo against the public{" "}
                  <a
                    href="https://osv.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    OSV.dev
                  </a>{" "}
                  vulnerability database and shows the result on the repo&apos;s{" "}
                  <strong>Dependencies</strong> tab.
                </p>
                <p className="mt-2">
                  <strong>Exact matches only:</strong> an advisory is only
                  reported as confirmed when the exact dependency version from
                  your committed lockfile (
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    package-lock.json
                  </code>
                  ,{" "}
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    yarn.lock
                  </code>
                  ,{" "}
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    Cargo.lock
                  </code>
                  ,{" "}
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    go.mod
                  </code>
                  , pinned{" "}
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    requirements.txt
                  </code>
                  , …) falls inside the version range the advisory declares as
                  affected. Versions guessed from ranges in{" "}
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    package.json
                  </code>{" "}
                  are listed separately as unconfirmed and never trigger alarms.
                </p>
                <p className="mt-2">
                  <strong>How the message looks:</strong> Telegram / Nostr DMs
                  lead with the <strong>repo name</strong>, list at most a few
                  findings, and link to a tracking Issues entry on that repo —
                  not a wall of hex URLs or truncated advisory dumps. Wording is
                  deliberately calm: this is a{" "}
                  <strong>dependency advisory notice</strong>, not a claim that
                  the project is compromised.
                </p>
                <p className="mt-2">
                  <strong>How often does the check run?</strong> The audit runs
                  fresh every time the <strong>Dependencies</strong> tab of a
                  repo is opened — there is no fixed schedule. It reads the
                  lockfiles from the <strong>pushed repo tip on gittr</strong>{" "}
                  (the bridge clone), not from files only on your laptop or only
                  on GitHub until those are synced here. Advisory details are
                  cached on the server for about 6 hours, so a newly published
                  CVE shows up within hours, at the latest on the next visit
                  after the cache expires.
                </p>
                <p className="mt-2">
                  <strong>How alerts reach you (Dependabot-style):</strong> when
                  a published <strong>CRITICAL or HIGH</strong> advisory matches
                  a <strong>direct</strong> pinned dependency on a repo that has
                  code on <strong>gittr</strong> (created / imported / pushed
                  here — not merely announced from another client), the platform
                  can open a normal <strong>Issues</strong> entry on that repo
                  (for tracking) and notify you on the{" "}
                  <strong>same channels</strong> you enabled (Nostr and/or
                  Telegram). That entry is visible on the repo&apos;s Issues tab
                  like any other issue — we avoid frightening “security
                  incident” branding. A lockfile match still needs{" "}
                  <strong>your</strong> check: whether your code actually uses
                  the affected APIs. All notification toggles (including
                  Security) live in one kind{" "}
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    30078
                  </code>{" "}
                  event (
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    d=gittr/notifications
                  </code>
                  ) so they sync across browsers. Save also registers delivery
                  on this server (Telegram User ID stays off public relays).
                </p>
                <p className="mt-2">
                  <strong>Your repos only — not watched / starred:</strong>{" "}
                  Security scans the repos you <strong>own</strong> on gittr
                  (your kind{" "}
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    30617
                  </code>{" "}
                  announcements), not projects you only watch, star, or follow.
                  Watching someone else&apos;s stack is intentionally out of
                  scope — noisy, permission-awkward, and easy to get wrong. If
                  you want CVE / early-warning coverage of another project,
                  <strong> fork or import it</strong> under your account so you
                  own the tip on gittr, then keep Push in sync as usual.
                </p>
                <p className="mt-2">
                  <strong>
                    Fresh tip only — keep announcement in line with source:
                  </strong>{" "}
                  the scanner reads lockfiles from the gittr bridge clone, but
                  only when Nostr repo state (kind{" "}
                  <code className="bg-gray-800 px-1 rounded text-xs">
                    30618
                  </code>
                  ) <strong>exactly matches</strong> that clone. No tip, or tip
                  ≠ bridge → <strong>skip</strong> (no DM about the wrong tree).
                  That match is what a successful <strong>Push</strong> from the
                  gittr UI is supposed to publish. If you changed the repo on
                  GitHub (or another forge) and want CVE coverage of that tip:
                  bring it onto gittr (sync / refetch from source on the repo),
                  then <strong>Push</strong> so the announcement lines up with
                  the mirror. A browser-only file refresh without Push does not
                  update the announcement. Same idea if you only update in
                  another Nostr git client — Push/sync on gittr again when you
                  want alerts here.
                </p>
                <p className="mt-2">
                  <strong>How notices are sent:</strong> when you are opted in,
                  the platform bot opens a calm dependency-tracking Issues entry
                  on that repo and DMs you (Nostr and/or Telegram per your
                  prefs) for each new CRITICAL/HIGH lockfile match. The same
                  advisory is not re-sent on later scans.
                </p>
                <p className="mt-2">
                  <strong>Early (pre-CVE) warnings — same opt-in:</strong> with
                  Security enabled you also get private DMs when the public{" "}
                  <a
                    href="https://vulnerabilityspoileralert.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    Vulnerability Spoiler Alert
                  </a>{" "}
                  RSS flags a HIGH/CRITICAL finding that looks related to a{" "}
                  <strong>direct</strong> dependency in that repo (often before
                  a CVE exists). There is no extra checkbox. These tips are{" "}
                  <strong>not</strong> shown on the Dependencies tab (that tab
                  stays OSV/confirmed only), and we do not open a gittr Issues
                  entry for them. If the Spoiler feed is unreachable,
                  Dependencies + normal dependency notices keep working
                  unchanged.
                </p>
                <p className="mt-2">
                  <strong>One alert per problem — not per scan:</strong> each
                  advisory triggers at most one issue per package per repo.
                  Repeated scans that find the same known vulnerability stay
                  silent.
                </p>
                <p className="mt-3 font-semibold text-gray-300">
                  Get the most protection:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4 mt-1 text-sm">
                  <li>
                    <strong>Commit your lockfiles.</strong> Without them, exact
                    versions can&apos;t be verified and you only get unconfirmed
                    hints.
                  </li>
                  <li>
                    <strong>Pin versions</strong> where your ecosystem supports
                    it (e.g.{" "}
                    <code className="bg-gray-800 px-1 rounded text-xs">
                      package==1.2.3
                    </code>{" "}
                    in requirements.txt).
                  </li>
                  <li>
                    <strong>Opt in and Save</strong> in Settings → Notifications
                    so consent is on relays — localStorage alone is not enough
                    for the bot.
                  </li>
                  <li>
                    <strong>Keep Push / announcement current.</strong> After
                    dependency or tip changes on GitHub (or on gittr), sync from
                    source if needed, then Push so kind{" "}
                    <code className="bg-gray-800 px-1 rounded text-xs">
                      30618
                    </code>{" "}
                    matches the tip on gittr — otherwise CVE alerts stay
                    skipped.
                  </li>
                  <li>
                    <strong>Check the Dependencies tab</strong> after importing
                    a repo and after dependency updates are on gittr.
                  </li>
                  <li>
                    <strong>Update affected packages</strong> to a version
                    outside the advisory&apos;s affected range, then get that
                    new lockfile onto gittr before re-checking the tab:{" "}
                    <strong>Nostr/git push</strong> if you fixed it locally, or{" "}
                    <strong>sync from the source forge + Push</strong> if you
                    fixed it there. Opening the tab alone does not see unpushed
                    or unsynced changes.
                  </li>
                </ul>
              </HelpTopic>
            )}

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

        <HelpSection
          id="publish-pages-apps"
          title={<>Publish Pages, Apps &amp; Releases</>}
        >
          <div className="space-y-2">
            <HelpTopic
              id="releases"
              title={<>Releases &amp; where they live</>}
            >
              <p>
                Think of three separate layers. Mixing them up is what causes
                confusion — not the UI itself.
              </p>

              <div className="mt-3 overflow-x-auto rounded border border-slate-600">
                <table className="w-full min-w-[640px] text-left text-sm text-gray-300">
                  <thead className="bg-slate-800/80 text-slate-100">
                    <tr>
                      <th className="p-3 font-semibold">Layer</th>
                      <th className="p-3 font-semibold">What it is</th>
                      <th className="p-3 font-semibold">Where it lives</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    <tr className="bg-slate-900/40">
                      <td className="p-3 align-top font-medium text-white">
                        Forge Release
                      </td>
                      <td className="p-3 align-top">
                        A tagged Release on GitHub / Codeberg / GitLab with real
                        download files (APK, AppImage, MSI, checksums, …).
                        Create those assets on the forge (or with their CLI /
                        CI).
                      </td>
                      <td className="p-3 align-top">
                        On that forge. gittr&apos;s{" "}
                        <strong className="text-white">Releases</strong> tab
                        syncs and lists them when the repo has a matching{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          source
                        </code>{" "}
                        URL. The same tab also lists{" "}
                        <strong className="text-white">NIP-82 / Blossom</strong>{" "}
                        releases from Nostr for GRASP-only repos (no forge
                        required to <em>read</em>).
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 align-top font-medium text-white">
                        gittr &quot;New release&quot;
                      </td>
                      <td className="p-3 align-top">
                        Optional notes / tag label in the browser for this repo.
                        Does <em>not</em> upload binaries yet (Blossom upload is
                        planned), and does <em>not</em> publish to{" "}
                        <Link
                          href="/apps"
                          className="text-purple-400 hover:text-purple-300"
                        >
                          /apps
                        </Link>
                        .
                      </td>
                      <td className="p-3 align-top">
                        Local to your browser (per-repo storage). Useful as a
                        memo; not a substitute for forge assets.
                      </td>
                    </tr>
                    <tr className="bg-slate-900/40">
                      <td className="p-3 align-top font-medium text-white">
                        Nostr Apps announce
                      </td>
                      <td className="p-3 align-top">
                        Owner-only, explicit step from the Code sidebar →{" "}
                        <strong className="text-white">Nostr Apps</strong>.
                        Needs a forge Release with an{" "}
                        <code className="text-purple-200">.apk</code> for
                        Zapstore. Other verified platform files on the same tag
                        can be linked as extra NIP-82 assets. You choose this —
                        it never runs on ordinary{" "}
                        <Link
                          href="#push-to-nostr"
                          className="text-purple-400 hover:text-purple-300"
                        >
                          Push to Nostr
                        </Link>
                        .
                      </td>
                      <td className="p-3 align-top">
                        Signed events on Nostr relays (kinds{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          32267
                        </code>{" "}
                        app,{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          30063
                        </code>{" "}
                        release,{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          3063
                        </code>{" "}
                        asset). Shown on{" "}
                        <Link
                          href="/apps"
                          className="text-purple-400 hover:text-purple-300"
                        >
                          /apps
                        </Link>
                        , your profile{" "}
                        <strong className="text-white">Apps</strong> section,
                        and optionally Zapstore. Download{" "}
                        <code className="bg-black/40 px-1 rounded text-xs">
                          url
                        </code>{" "}
                        still points at the forge unless you host elsewhere.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <HelpSubTopic title={<>Suggested flow</>}>
                <ol className="list-decimal list-inside space-y-1.5 ml-1 text-sm text-gray-300">
                  <li>
                    Publish installers on the forge Release for that tag (CI or
                    manual upload).
                  </li>
                  <li>
                    Open the repo on gittr →{" "}
                    <strong className="text-white">Releases</strong> — assets
                    should appear after a soft refresh from the forge.
                  </li>
                  <li>
                    (Optional) On that forge tag, click{" "}
                    <strong className="text-white">Announce on Nostr</strong>{" "}
                    (same Zapstore rules as Code sidebar →{" "}
                    <strong className="text-white">Nostr Apps</strong>): verify
                    APK → <strong>Publish on Nostr</strong> for{" "}
                    <Link
                      href="/apps"
                      className="text-purple-400 hover:text-purple-300"
                    >
                      /apps
                    </Link>{" "}
                    / Zapstore.
                  </li>
                  <li>
                    Prefer a{" "}
                    <strong className="text-white">new version / tag</strong>{" "}
                    when binaries change. Re-announce the same version only to
                    fix a bad listing.
                  </li>
                </ol>
              </HelpSubTopic>

              <p className="mt-3 text-sm text-gray-400">
                If the forge later goes offline, mirrored{" "}
                <strong className="text-gray-300">source code</strong> (after
                Push) can still be cloned from GRASP — but{" "}
                <strong className="text-gray-300">release installers</strong>{" "}
                that only lived on the forge will not. Full table:{" "}
                <Link
                  href="#when-source-goes-offline"
                  className="text-purple-400 hover:text-purple-300"
                >
                  When your git host goes dark
                </Link>
                .
              </p>
            </HelpTopic>

            <HelpTopic title={<>Nostr Pages (static sites)</>}>
              <p>
                Owners publish a static site from the repo Code sidebar →{" "}
                <strong className="text-white">Nostr Pages</strong>: add a root
                entry file (for example{" "}
                <code className="text-purple-200">index.html</code>), keep the
                README Pages block in sync, <strong>Push to Nostr</strong>, then{" "}
                <strong>Push Manifest</strong> (uploads to Blossom and publishes
                kind <strong>35128</strong>). Browse live sites at{" "}
                <Link
                  href="/pages"
                  className="text-purple-400 hover:text-purple-300"
                >
                  /pages
                </Link>
                .
              </p>
              <p className="mt-3 text-sm text-gray-300">
                gittr&apos;s gateway is adapted from{" "}
                <strong className="text-white">hzrd146</strong>&apos;s nsite
                work — credit where it&apos;s due:
              </p>
              <ul className="mt-2 text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                <li>
                  Upstream:{" "}
                  <a
                    href={HZRD146_NSITE_GATEWAY}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    hzrd146 / nsite-gateway
                  </a>
                </li>
                <li>
                  gittr fork / deploy:{" "}
                  <a
                    href={GITTR_REPO_NSITE_GATEWAY}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    gittr / nsite-gateway
                  </a>
                </li>
              </ul>
            </HelpTopic>

            <HelpTopic title={<>Nostr Apps &amp; Zapstore</>}>
              <p>
                Owners list an Android app from the Code sidebar →{" "}
                <strong className="text-white">Nostr Apps</strong>: link a
                GitHub / Codeberg / GitLab source URL, pick a{" "}
                <strong className="text-white">Release</strong> that includes an{" "}
                <code className="text-purple-200">.apk</code>, verify the APK,
                then <strong>Publish on Nostr</strong> (NIP-82). Zapstore needs
                the APK; other binaries on the same Release tag (DMG, AppImage,
                MSI/EXE, …) can be linked as extra NIP-82 assets on that
                version. Files stay on the forge; gittr only announces. The repo{" "}
                <strong className="text-white">Releases</strong> tab lists all
                forge download assets (not only APKs). How Releases, forge
                files, and announces fit together:{" "}
                <Link
                  href="#releases"
                  className="text-purple-400 hover:text-purple-300"
                >
                  Releases &amp; where they live
                </Link>
                . Discover apps at{" "}
                <Link
                  href="/apps"
                  className="text-purple-400 hover:text-purple-300"
                >
                  /apps
                </Link>
                .
              </p>
              <p className="mt-3 text-sm text-gray-300">
                Optional Zapstore catalog: add{" "}
                <code className="text-purple-200">zapstore.yaml</code> at the
                source repo root, then publish again. Details:
              </p>
              <ul className="mt-2 text-sm text-gray-300 space-y-1 list-disc list-inside ml-2">
                <li>
                  Zapstore on gittr:{" "}
                  <a
                    href={ZAPSTORE_ON_GITTR}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    zapstore
                  </a>
                </li>
                <li>
                  Publish docs:{" "}
                  <a
                    href={ZAPSTORE_PUBLISH_DOCS}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    zapstore.dev/docs/publish
                  </a>
                </li>
              </ul>
            </HelpTopic>
          </div>
        </HelpSection>

        {/* Collaboration */}
        <HelpSection id="collaboration" title={<>Collaboration</>}>
          <div className="space-y-2">
            <HelpTopic id="pull-requests" title={<>Pull Requests</>}>
              <p>
                Create PRs to propose changes. Reviewers can approve, request
                changes, or merge PRs. Repo owners editing their own Nostr /
                bridge repos on the Code tab can <strong>Save changes</strong>{" "}
                locally and use <strong>Push to Nostr</strong> — they do not
                need a PR.
              </p>

              <div className="mt-3 p-3 bg-emerald-900/20 border border-emerald-600/30 rounded">
                <p className="text-sm font-semibold text-emerald-200 mb-2">
                  Merge vs Close (what hits Nostr)
                </p>
                <ul className="text-sm text-gray-300 space-y-2 list-disc list-inside ml-2">
                  <li>
                    <strong>Merge:</strong> applies the PR files and{" "}
                    <strong>pushes the updated tip</strong> to Nostr / the
                    bridge (same idea as Code-tab Push to Nostr). Other clients
                    can see the new files after merge. You do{" "}
                    <strong>not</strong> need an extra Push to Nostr afterward
                    when that push succeeds.
                  </li>
                  <li>
                    <strong>Close (without merging):</strong> publishes a NIP-34
                    closed status event to relays so other git Nostr clients see
                    it closed. It does <strong>not</strong> change files and
                    does <strong>not</strong> need Code-tab{" "}
                    <strong>Push to Nostr</strong> (that is for repo files /
                    tip). Use Close to drop an unwanted PR.
                  </li>
                  <li>
                    <strong>Reopen:</strong> publishes open status to Nostr —
                    still no file / tip push.
                  </li>
                </ul>
              </div>

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
