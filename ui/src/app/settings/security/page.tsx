"use client";

import EncryptionSetup, {
  useBrowserLoginSnapshot,
} from "@/components/security/EncryptionSetup";
import SettingsHero from "@/components/settings-hero";
import {
  aboutEncryptionItems,
  bestPracticeItems,
  signingStatusCopy,
  whatGetsEncryptedItems,
} from "@/lib/security/browser-login-method";

import { CheckCircle, Info, Lock } from "lucide-react";

export default function SecurityPage() {
  const { ready, ...snapshot } = useBrowserLoginSnapshot();
  const signing = signingStatusCopy(snapshot);
  const about = aboutEncryptionItems(snapshot);
  const practices = bestPracticeItems(snapshot.method);
  const encrypted = whatGetsEncryptedItems(snapshot);
  const signingTone =
    snapshot.method === "nsec"
      ? "warn"
      : snapshot.method === "none"
      ? "muted"
      : "ok";
  const practicesAreWarnings =
    signingTone === "warn" || snapshot.method === "none";

  return (
    <div>
      <SettingsHero title="Security" />

      <div className="space-y-6 mt-6">
        {!ready ? (
          <div className="border border-gray-700 rounded-lg p-4">
            <p className="text-sm text-gray-400">Checking how you sign in…</p>
          </div>
        ) : (
          <>
            <div
              className={
                signingTone === "ok"
                  ? "border border-green-600 bg-green-900/20 rounded-lg p-4"
                  : signingTone === "warn"
                  ? "border border-yellow-600 bg-yellow-900/20 rounded-lg p-4"
                  : "border border-gray-700 rounded-lg p-4"
              }
            >
              <div className="flex items-start gap-2">
                {signingTone === "ok" ? (
                  <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
                ) : (
                  <Info
                    className={
                      signingTone === "warn"
                        ? "h-5 w-5 text-yellow-400 mt-0.5"
                        : "h-5 w-5 text-gray-400 mt-0.5"
                    }
                  />
                )}
                <div className="flex-1">
                  <h3
                    className={
                      signingTone === "ok"
                        ? "font-semibold text-green-400 mb-1"
                        : signingTone === "warn"
                        ? "font-semibold text-yellow-400 mb-1"
                        : "font-semibold text-gray-200 mb-1"
                    }
                  >
                    {signing.title}
                  </h3>
                  <p className="text-sm text-gray-300">{signing.body}</p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Data Encryption
              </h2>
              <EncryptionSetup snapshot={snapshot} />
            </div>

            <div className="border border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Info className="h-5 w-5 text-blue-400 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-400 mb-1">
                    About Encryption
                  </h3>
                  <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
                    {about.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div
              className={
                practicesAreWarnings
                  ? "border border-yellow-600 bg-yellow-900/20 rounded-lg p-4 space-y-3"
                  : "border border-gray-700 rounded-lg p-4 space-y-3"
              }
            >
              <div className="flex items-start gap-2">
                <Info
                  className={
                    practicesAreWarnings
                      ? "h-5 w-5 text-yellow-400 mt-0.5"
                      : "h-5 w-5 text-blue-400 mt-0.5"
                  }
                />
                <div className="flex-1">
                  <h3
                    className={
                      practicesAreWarnings
                        ? "font-semibold text-yellow-400 mb-1"
                        : "font-semibold text-blue-400 mb-1"
                    }
                  >
                    {practicesAreWarnings
                      ? "Security Best Practices"
                      : "For this login"}
                  </h3>
                  <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
                    {practices.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="border border-gray-700 rounded-lg p-4">
              <h3 className="font-semibold mb-2">What Gets Encrypted</h3>
              <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
                {encrypted.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="text-xs text-gray-400 mt-3">{encrypted.note}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
