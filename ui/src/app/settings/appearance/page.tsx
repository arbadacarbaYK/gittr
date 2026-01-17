"use client";

import { useEffect, useState } from "react";

import SettingsHero from "@/components/settings-hero";

const THEMES = [
  { id: "bitcoin", label: "Bitcoin (orange/gray)" },
  { id: "classic", label: "Classic" },
  { id: "cypherpunk", label: "Cypherpunk (neon green/terminal)" },
  { id: "girly", label: "Girly (pink pastels)" },
  { id: "arcade80s", label: "80s Arcade (neon cyan/magenta)" },
];

const QR_STYLES = [
  { id: "classic", label: "Classic (standard QR)" },
  { id: "rounded", label: "Rounded corners" },
  { id: "dots", label: "Dots style" },
];

export default function AppearancePage() {
  const [theme, setTheme] = useState("bitcoin");
  const [qrStyle, setQrStyle] = useState("classic");

  useEffect(() => {
    const t = localStorage.getItem("gittr_theme") || "bitcoin";
    const q = localStorage.getItem("gittr_qr_style") || "classic";
    setTheme(t);
    setQrStyle(q);
    // Apply theme immediately on load
    document.documentElement.dataset.theme = t;
  }, []);

  function applyTheme(t: string) {
    setTheme(t);
    localStorage.setItem("gittr_theme", t);
    // Apply theme immediately
    document.documentElement.dataset.theme = t;
    // Dispatch event so layout.tsx can also update
    window.dispatchEvent(new Event("theme-changed"));
    // Force style recalculation
    const html = document.documentElement;
    const currentTheme = html.dataset.theme;
    html.removeAttribute("data-theme");
    // Force reflow
    void html.offsetWidth;
    html.dataset.theme = t;
  }

  function applyQrStyle(s: string) {
    setQrStyle(s);
    localStorage.setItem("gittr_qr_style", s);
    // Dispatch event so QR components can update immediately
    window.dispatchEvent(new Event("qr-style-changed"));
  }

  return (
    <div className="p-6">
      <SettingsHero title="Appearance" />

      <div className="mt-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-3">Theme</h3>
          <div className="space-y-2">
            {THEMES.map((t) => (
              <label
                key={t.id}
                className="flex gap-2 items-center cursor-pointer"
              >
                <input
                  type="radio"
                  name="theme"
                  checked={theme === t.id}
                  onChange={() => applyTheme(t.id)}
                  className="cursor-pointer"
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-3">QR Code Style</h3>
          <div className="space-y-2">
            {QR_STYLES.map((s) => (
              <label
                key={s.id}
                className="flex gap-2 items-center cursor-pointer"
              >
                <input
                  type="radio"
                  name="qrStyle"
                  checked={qrStyle === s.id}
                  onChange={() => applyQrStyle(s.id)}
                  className="cursor-pointer"
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Choose how QR codes appear when paying invoices or sharing
            repositories.
          </p>
        </div>
      </div>
    </div>
  );
}
