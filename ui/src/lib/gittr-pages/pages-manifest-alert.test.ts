import { describe, expect, it } from "vitest";

import {
  formatPagesManifestErrorAlert,
  formatPagesManifestSuccessAlert,
} from "./pages-manifest-alert";

const liveUrl =
  "https://3un05jr4dnwh6njreq6uhzgv67st83jxi5lnpsbf8y3dkdq1qkgitnostr.pages.gittr.space/";

describe("formatPagesManifestSuccessAlert", () => {
  it("uses a green check when ingest already found the site", () => {
    const msg = formatPagesManifestSuccessAlert({
      manifestEventId: "aaaaaaaaaaaaaaaa",
      pathCount: 12,
      confirmed: true,
      namedUrl: liveUrl,
      ingestFound: true,
    });
    expect(msg.startsWith("✅ Pages live.")).toBe(true);
    expect(msg).toContain(liveUrl);
    expect(msg).not.toContain("catching up");
  });

  it("says the directory is catching up when ingest missed", () => {
    const msg = formatPagesManifestSuccessAlert({
      manifestEventId: "aaaaaaaaaaaaaaaa",
      pathCount: 12,
      confirmed: true,
      namedUrl: liveUrl,
      ingestFound: false,
    });
    expect(msg.startsWith("⚠️")).toBe(true);
    expect(msg).toContain("catching up");
    expect(msg).toContain("few seconds");
  });

  it("warns when relays have not confirmed", () => {
    const msg = formatPagesManifestSuccessAlert({
      manifestEventId: "aaaaaaaaaaaaaaaa",
      pathCount: 12,
      confirmed: false,
      namedUrl: liveUrl,
    });
    expect(msg.startsWith("⚠️")).toBe(true);
    expect(msg).toContain("awaiting relay confirmation");
  });
});

describe("formatPagesManifestErrorAlert", () => {
  it("uses the same fail mark as repo push", () => {
    expect(formatPagesManifestErrorAlert("blossom 401")).toBe(
      "❌ Manifest publish failed.\n\nblossom 401"
    );
  });
});
