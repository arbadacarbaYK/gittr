"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isEncryptionEnabled,
  migrateToEncrypted,
  setEncryptionPassword,
  verifyEncryptionPassword,
} from "@/lib/security/encryption";

import { AlertCircle, CheckCircle, Lock, Shield } from "lucide-react";

export default function EncryptionSetup() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);

  // Check if encryption is already enabled on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const enabled = isEncryptionEnabled();
      setEncryptionEnabled(enabled);
      if (enabled && !getSessionPassword()) {
        setShowUnlock(true);
      }
    }
  }, []);

  function getSessionPassword(): string | null {
    if (typeof window === "undefined") return null;
    return (window as any).__gittr_encryption_password || null;
  }

  const handleSetup = async () => {
    setError("");
    setSuccess("");

    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsSettingUp(true);
    try {
      // Set encryption password
      await setEncryptionPassword(password);

      // Migrate existing sensitive data
      try {
        const plaintextPrivkey = localStorage.getItem("nostr:privkey");
        if (plaintextPrivkey) {
          await migrateToEncrypted(
            "nostr:privkey",
            password,
            () => plaintextPrivkey
          );
          setSuccess(
            "Encryption enabled! Your private keys have been encrypted."
          );
        } else {
          setSuccess("Encryption enabled!");
        }
      } catch (err: any) {
        setError(err.message || "Failed to migrate existing keys");
      }

      setEncryptionEnabled(true);
      setShowSetup(false);
      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Failed to set up encryption");
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleVerify = async () => {
    setError("");
    setSuccess("");

    if (!verifyPassword) {
      setError("Please enter your password");
      return;
    }

    setIsVerifying(true);
    try {
      const isValid = await verifyEncryptionPassword(verifyPassword);
      if (isValid) {
        setSuccess("Password verified! Encryption is active.");
        setShowUnlock(false);
        // Store verified password in session (memory only, cleared on page unload)
        // This allows decryption without asking for password every time
        if (typeof window !== "undefined") {
          (window as any).__gittr_encryption_password = verifyPassword;
        }
      } else {
        setError("Incorrect password");
      }
    } catch (err: any) {
      setError(err.message || "Failed to verify password");
    } finally {
      setIsVerifying(false);
    }
  };

  // Check if there's actually a private key stored
  const [hasPrivateKey, setHasPrivateKey] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Check both plaintext and encrypted storage
      const plaintextKey = localStorage.getItem("nostr:privkey");
      // Check if encryption is enabled and there might be encrypted data
      const encryptionEnabled = isEncryptionEnabled();
      setHasPrivateKey(
        !!plaintextKey ||
          (encryptionEnabled &&
            !!localStorage.getItem("gittr:encrypted:nostr:privkey"))
      );
    }
  }, []);

  // Check if using NIP-07 (keys stay in extension, not localStorage)
  const [usingNip07, setUsingNip07] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setUsingNip07(typeof window.nostr !== "undefined");
    }
  }, []);

  if (!encryptionEnabled && !showSetup) {
    // Only show warning if there's actually a private key stored
    // If using NIP-07 only, no keys should be in localStorage
    if (!hasPrivateKey) {
      return (
        <div className="border border-green-600 bg-green-900/20 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-2">
            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-400 mb-1">
                No Private Keys Stored
              </h3>
              <p className="text-sm text-gray-300">
                {usingNip07
                  ? "You're using NIP-07 extension login. Your private keys stay in the extension and are never stored in localStorage. This is the most secure option."
                  : "No Nostr private keys are currently stored in localStorage. If you use NIP-07 extension login, keys stay in the extension and are never stored here."}
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Show warning only if private key exists
    return (
      <div className="border border-yellow-600 bg-yellow-900/20 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-yellow-400 mb-1">
              Security Warning
            </h3>
            <p className="text-sm text-gray-300 mb-3">
              Your Nostr private keys are currently stored as plaintext in
              browser localStorage. This means anyone with access to your
              browser can see your keys.
            </p>
            <p className="text-xs text-yellow-300 mb-3">
              💡 <strong>Tip:</strong> For better security, use NIP-07 extension
              login instead. Keys stay in the extension and are never stored in
              localStorage.
            </p>
            <Button
              onClick={() => setShowSetup(true)}
              className="bg-yellow-600 hover:bg-yellow-700 text-white"
            >
              <Lock className="h-4 w-4 mr-2" />
              Enable Encryption
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (showSetup) {
    return (
      <div className="border border-purple-600 bg-purple-900/20 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Shield className="h-5 w-5 text-purple-400 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-purple-400 mb-1">
              Enable Data Encryption
            </h3>
            <p className="text-sm text-gray-300 mb-4">
              Set a password to encrypt your private keys. You'll need to enter
              this password once per browser session to decrypt your keys.
            </p>

            {error && (
              <div className="bg-red-900/30 border border-red-600 rounded p-2 mb-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-900/30 border border-green-600 rounded p-2 mb-3 text-sm text-green-400">
                {success}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <Label htmlFor="enc-password">Encryption Password</Label>
                <Input
                  id="enc-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="enc-confirm">Confirm Password</Label>
                <Input
                  id="enc-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="mt-1"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSetup}
                  disabled={isSettingUp || !password || !confirmPassword}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {isSettingUp ? "Setting up..." : "Enable Encryption"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowSetup(false);
                    setPassword("");
                    setConfirmPassword("");
                    setError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (showUnlock) {
    return (
      <div className="border border-purple-600 bg-purple-900/20 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Lock className="h-5 w-5 text-purple-400 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-purple-400 mb-1">
              Unlock Encryption
            </h3>
            <p className="text-sm text-gray-300 mb-4">
              Enter your encryption password to decrypt your private keys for
              this session.
            </p>

            {error && (
              <div className="bg-red-900/30 border border-red-600 rounded p-2 mb-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <Label htmlFor="unlock-password">Encryption Password</Label>
                <Input
                  id="unlock-password"
                  type="password"
                  value={verifyPassword}
                  onChange={(e) => setVerifyPassword(e.target.value)}
                  placeholder="Enter your encryption password"
                  className="mt-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleVerify();
                    }
                  }}
                />
              </div>
              <Button
                onClick={handleVerify}
                disabled={isVerifying || !verifyPassword}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isVerifying ? "Verifying..." : "Unlock"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Encryption is enabled and unlocked
  return (
    <div className="border border-green-600 bg-green-900/20 rounded-lg p-4">
      <div className="flex items-start gap-2">
        <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold text-green-400 mb-1">
            Encryption Active
          </h3>
          <p className="text-sm text-gray-300">
            Your private keys are encrypted. The encryption password is stored
            in memory for this session only.
          </p>
        </div>
      </div>
    </div>
  );
}
