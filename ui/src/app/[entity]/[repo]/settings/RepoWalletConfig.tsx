"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type StoredRepo,
  loadStoredRepos,
  saveStoredRepos,
} from "@/lib/repos/storage";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { normalizeUrlOnBlur } from "@/lib/utils/url-normalize";

interface RepoWalletConfigProps {
  entity: string;
  repo: string;
  onConfigChange?: (config: {
    lnurl?: string;
    lnaddress?: string;
    nwcRecv?: string;
    lnbitsUrl?: string;
    lnbitsAdminKey?: string;
    nwcSend?: string;
  }) => void;
}

export default function RepoWalletConfig({
  entity,
  repo,
  onConfigChange,
}: RepoWalletConfigProps) {
  const [config, setConfig] = useState<{
    lnurl?: string;
    lnaddress?: string;
    nwcRecv?: string;
    lnbitsUrl?: string;
    lnbitsAdminKey?: string;
    nwcSend?: string;
  }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const repoData = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
      const repoWithWallet = repoData as StoredRepo & {
        walletConfig?: typeof config;
      };
      if (repoWithWallet?.walletConfig) {
        setConfig(repoWithWallet.walletConfig);
      }
    } catch {}
  }, [entity, repo]);

  const handleSave = () => {
    setSaving(true);
    try {
      const repos = loadStoredRepos();
      const repoIndex = repos.findIndex((r: StoredRepo) => {
        const found = findRepoByEntityAndName<StoredRepo>([r], entity, repo);
        return found !== undefined;
      });
      if (repoIndex >= 0) {
        const repoWithWallet = repos[repoIndex] as StoredRepo & {
          walletConfig?: typeof config;
        };
        repos[repoIndex] = {
          ...repoWithWallet,
          walletConfig: Object.keys(config).length > 0 ? config : undefined,
        } as StoredRepo & { walletConfig?: typeof config };
        saveStoredRepos(repos);
        if (onConfigChange) {
          onConfigChange(config);
        }
      }
      setSaving(false);
      alert("Wallet configuration saved!");
    } catch (error) {
      setSaving(false);
      alert("Failed to save wallet configuration");
    }
  };

  return (
    <div className="space-y-4 p-4 border border-gray-700 rounded bg-gray-900">
      <div>
        <Label className="text-xs text-gray-400 mb-2 block">
          Receiving (LNURL / Lightning Address / NWC)
        </Label>
        <p className="text-xs text-gray-500 mb-2">
          Configure wallet addresses for this repository (optional - defaults to
          owner's settings). Receiving: where zaps to the repo come in.
        </p>
        <div className="space-y-2">
          <div>
            <Label htmlFor="repo-lnurl" className="text-xs">
              LNURL
            </Label>
            <Input
              id="repo-lnurl"
              value={config.lnurl || ""}
              onChange={(e) => setConfig({ ...config, lnurl: e.target.value })}
              onBlur={(e) => {
                const normalized = normalizeUrlOnBlur(e.target.value);
                if (normalized !== e.target.value) {
                  setConfig({ ...config, lnurl: normalized });
                }
              }}
              placeholder="example.com/lnurl or https://..."
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="repo-lnaddress" className="text-xs">
              Lightning Address
            </Label>
            <Input
              id="repo-lnaddress"
              value={config.lnaddress || ""}
              onChange={(e) =>
                setConfig({ ...config, lnaddress: e.target.value })
              }
              placeholder="name@domain.com"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="repo-nwc-recv" className="text-xs">
              NWC Receive
            </Label>
            <Input
              id="repo-nwc-recv"
              value={config.nwcRecv || ""}
              onChange={(e) =>
                setConfig({ ...config, nwcRecv: e.target.value })
              }
              placeholder="nostr+walletconnect://..."
              className="mt-1"
            />
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs text-gray-400 mb-2 block">
          Sending (for splits when repo receives zaps)
        </Label>
        <p className="text-xs text-gray-500 mb-2">
          Note: Bounties use the owner's wallet (Settings → Account), not the
          repo wallet
        </p>
        <div className="space-y-2">
          <div>
            <Label htmlFor="repo-lnbits-url" className="text-xs">
              LNbits URL
            </Label>
            <Input
              id="repo-lnbits-url"
              value={config.lnbitsUrl || ""}
              onChange={(e) =>
                setConfig({ ...config, lnbitsUrl: e.target.value })
              }
              onBlur={(e) => {
                const normalized = normalizeUrlOnBlur(e.target.value);
                if (normalized !== e.target.value) {
                  setConfig({ ...config, lnbitsUrl: normalized });
                }
              }}
              placeholder="bitcoindelta.club or https://..."
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="repo-lnbits-key" className="text-xs">
              LNbits Admin Key
            </Label>
            <Input
              id="repo-lnbits-key"
              type="password"
              value={config.lnbitsAdminKey || ""}
              onChange={(e) =>
                setConfig({ ...config, lnbitsAdminKey: e.target.value })
              }
              placeholder="Admin key"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="repo-nwc-send" className="text-xs">
              NWC Send
            </Label>
            <Input
              id="repo-nwc-send"
              value={config.nwcSend || ""}
              onChange={(e) =>
                setConfig({ ...config, nwcSend: e.target.value })
              }
              placeholder="nostr+walletconnect://..."
              className="mt-1"
            />
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? "Saving..." : "Save Wallet Config"}
      </Button>
      <p className="text-xs text-gray-500">
        If left empty, uses the owner's default wallet from Settings → Account
      </p>
    </div>
  );
}
