"use client";

import { X, Terminal, Key, GitBranch, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SSHGitHelpProps {
  entity: string;
  repo: string;
  sshUrl?: string;
  httpsUrls?: string[];
  nostrUrls?: string[];
  onClose?: () => void;
}

export function SSHGitHelp({ entity, repo, sshUrl, httpsUrls, nostrUrls, onClose }: SSHGitHelpProps) {
  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-gray-900 border border-gray-700 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            SSH & Git Access Guide
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="text-gray-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Quick Start */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Key className="h-4 w-4" />
              1. Set Up SSH Keys
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-gray-300 text-sm">
              <li>Go to <strong>Settings → SSH Keys</strong></li>
              <li>Either:
                <ul className="list-disc list-inside ml-6 mt-1 space-y-1">
                  <li><strong>Generate new key</strong>: Download private key, save to <code className="bg-gray-800 px-1 rounded">~/.ssh/id_ed25519</code></li>
                  <li><strong>Add existing key</strong>: Paste public key from <code className="bg-gray-800 px-1 rounded">~/.ssh/id_*.pub</code></li>
                </ul>
              </li>
            </ol>
          </div>

          {/* Clone */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              2. Clone Repository
            </h3>
            <div className="space-y-3">
            <div className="bg-gray-800 border border-gray-700 rounded p-3">
                <p className="text-sm text-green-400 font-semibold mb-2">Option A: SSH (Standard Git - Recommended)</p>
              <code className="block text-green-400 font-mono text-sm break-all">
                {sshUrl || `git clone git@gittr.space:${entity}/${repo}.git`}
              </code>
              {sshUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(`git clone ${sshUrl}`);
                  }}
                  className="mt-2 text-xs"
                >
                    Copy SSH Clone Command
                </Button>
              )}
                <p className="mt-2 text-xs text-gray-400">Standard Git approach, no additional tools needed. Requires SSH keys (see Step 1).</p>
              </div>
              <div className="bg-gray-800 border border-blue-700 rounded p-3">
                <p className="text-sm text-blue-300 font-semibold mb-2">Option B: HTTPS (GRASP git servers)</p>
                <code className="block text-blue-200 font-mono text-sm break-all">
                  {httpsUrls && httpsUrls.length > 0
                    ? `git clone ${httpsUrls[0]}`
                    : `git clone https://relay.ngit.dev/${entity}/${repo}.git`}
                </code>
                {httpsUrls && httpsUrls.length > 1 && (
                  <p className="mt-2 text-[11px] text-gray-400">
                    Other mirrors: {httpsUrls.slice(1, 4).join(", ")}
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  Works anywhere Git is available (CI, Codespaces, etc.). Read-only unless the remote grants access.
                </p>
              </div>
              
              <div className="bg-gray-800 border border-purple-700 rounded p-3">
                <p className="text-sm text-purple-400 font-semibold mb-2">Option C: nostr:// Protocol (Ecosystem Standard)</p>
                {(nostrUrls && nostrUrls.length > 0 ? nostrUrls : [
                  `nostr://${entity.substring(0, 12)}@relay.ngit.dev/${repo}`
                ]).map((url, idx) => (
                  <code key={idx} className="block text-purple-200 font-mono text-sm break-all">
                    git clone {url}
                  </code>
                ))}
                <p className="mt-2 text-xs text-gray-400">
                  Requires <code className="bg-gray-900 px-1 rounded">git-remote-nostr</code>. Matches the format used by other NIP-34 clients.
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              All three formats are published in each NIP-34 repository event. Use whichever best fits your tooling.
            </p>
          </div>

          {/* Push */}
          <div>
            <h3 className="text-lg font-semibold mb-3">3. Push Changes</h3>
            <div className="bg-gray-800 border border-gray-700 rounded p-3 space-y-2">
              <code className="block text-green-400 font-mono text-sm">
                git add .
              </code>
              <code className="block text-green-400 font-mono text-sm">
                git commit -m "Update code"
              </code>
              <code className="block text-green-400 font-mono text-sm">
                git push origin main
              </code>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              Only repository owners can push. For collaborative changes, create a pull request via the web interface.
            </p>
          </div>

          {/* Troubleshooting */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Common Issues</h3>
            <div className="space-y-3 text-sm text-gray-300">
              <div>
                <strong className="text-yellow-400">"Permission denied (publickey)"</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1 text-xs">
                  <li>Check SSH key is added in Settings → SSH Keys</li>
                  <li>Verify private key permissions (600): <code className="bg-gray-800 px-1 rounded">chmod 600 ~/.ssh/id_*</code></li>
                </ul>
              </div>
              <div>
                <strong className="text-yellow-400">"Push rejected"</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1 text-xs">
                  <li>Only owners can push directly</li>
                  <li>Create a pull request for collaborative changes</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Learn More */}
          <div className="pt-4 border-t border-gray-700">
            <p className="text-xs text-gray-400">
              For detailed documentation, see <a href="https://github.com/arbadacarbaYK/gittr/blob/main/docs/SSH_GIT_GUIDE.md" className="text-purple-400 hover:underline" target="_blank" rel="noopener noreferrer">SSH & Git Guide</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

