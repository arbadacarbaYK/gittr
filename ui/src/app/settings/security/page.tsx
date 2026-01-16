"use client";

import EncryptionSetup from "@/components/security/EncryptionSetup";
import SettingsHero from "@/components/settings-hero";

import { AlertTriangle, Info, Lock } from "lucide-react";

export default function SecurityPage() {
  return (
    <div>
      <SettingsHero title="Security" />

      <div className="space-y-6 mt-6">
        {/* Encryption Setup */}
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Data Encryption
          </h2>
          <EncryptionSetup />
        </div>

        {/* Security Information */}
        <div className="border border-gray-700 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="h-5 w-5 text-blue-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-blue-400 mb-1">
                About Encryption
              </h3>
              <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
                <li>Encryption uses AES-256-GCM with PBKDF2 key derivation</li>
                <li>
                  Your password is never stored - only a hash for verification
                </li>
                <li>Encrypted data is stored in browser localStorage</li>
                <li>
                  You'll need to enter your password once per browser session
                </li>
                <li>
                  Password is stored in memory only (cleared when browser
                  closes)
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Security Best Practices */}
        <div className="border border-yellow-600 bg-yellow-900/20 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-yellow-400 mb-1">
                Security Best Practices
              </h3>
              <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
                <li>
                  <strong>Use NIP-07 extension</strong> (recommended) - Keys
                  stay in extension, never in localStorage
                </li>
                <li>
                  <strong>Enable encryption</strong> if you must use nsec login
                  - Adds password protection
                </li>
                <li>
                  <strong>Clear localStorage</strong> after using shared
                  computers
                </li>
                <li>
                  <strong>Never share</strong> your encryption password or
                  private keys
                </li>
                <li>
                  <strong>Use strong passwords</strong> - At least 12 characters
                  with mixed characters
                </li>
                <li>
                  <strong>Browser extensions</strong> can access localStorage -
                  Only install trusted extensions
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* What's Encrypted */}
        <div className="border border-gray-700 rounded-lg p-4">
          <h3 className="font-semibold mb-2">What Gets Encrypted</h3>
          <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
            <li>
              <strong>Nostr Private Keys</strong> (if using nsec login) - Most
              critical
            </li>
            <li>Other sensitive data may be encrypted in future updates</li>
          </ul>
          <p className="text-xs text-gray-400 mt-3">
            Note: Public keys, repository data, and settings are stored
            unencrypted (they're not sensitive).
          </p>
        </div>
      </div>
    </div>
  );
}
