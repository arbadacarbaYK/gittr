import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterPrivateNetworkRelaysForPublicSite,
  hostnameLooksPrivateOrLocal,
  isPrivateOrLocalIp,
  omitHomeLanRelayUrls,
  shouldFilterPrivateRelaysInBrowser,
  urlLooksPrivateOrLocal,
} from "./private-network-host";

describe("hostnameLooksPrivateOrLocal", () => {
  it("blocks LAN, mDNS, Tailscale MagicDNS, and CGNAT", () => {
    expect(hostnameLooksPrivateOrLocal("umbrel.local")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("nas.lan")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("umbrel.tail51469b.ts.net")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("100.64.1.8")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("100.127.0.1")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("192.168.1.1")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("localhost")).toBe(true);
  });

  it("allows public hosts including failed-but-public relays", () => {
    expect(hostnameLooksPrivateOrLocal("relay.ngit.dev")).toBe(false);
    expect(hostnameLooksPrivateOrLocal("gittr.space")).toBe(false);
    expect(hostnameLooksPrivateOrLocal("relay.stewlab.win")).toBe(false);
    expect(hostnameLooksPrivateOrLocal("100.63.0.1")).toBe(false);
  });
});

describe("isPrivateOrLocalIp", () => {
  it("treats Tailscale CGNAT as private", () => {
    expect(isPrivateOrLocalIp("100.64.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("8.8.8.8")).toBe(false);
  });
});

describe("urlLooksPrivateOrLocal", () => {
  it("parses wss with custom ports", () => {
    expect(urlLooksPrivateOrLocal("wss://umbrel.local:4848/")).toBe(true);
    expect(urlLooksPrivateOrLocal("wss://umbrel.tail51469b.ts.net:4848/")).toBe(
      true
    );
    expect(urlLooksPrivateOrLocal("wss://relay.ngit.dev")).toBe(false);
  });
});

describe("filterPrivateNetworkRelaysForPublicSite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips LAN relays when the page is gittr.space", () => {
    vi.stubGlobal("window", {
      location: { hostname: "gittr.space" },
    });
    expect(shouldFilterPrivateRelaysInBrowser()).toBe(true);
    expect(
      filterPrivateNetworkRelaysForPublicSite([
        "wss://relay.gittr.space",
        "wss://umbrel.local:4848",
        "wss://umbrel.tail51469b.ts.net:4848/",
        "wss://relay.stewlab.win",
      ])
    ).toEqual(["wss://relay.gittr.space", "wss://relay.stewlab.win"]);
  });

  it("keeps LAN relays when gittr itself is on localhost", () => {
    vi.stubGlobal("window", {
      location: { hostname: "localhost" },
    });
    expect(shouldFilterPrivateRelaysInBrowser()).toBe(false);
    expect(
      filterPrivateNetworkRelaysForPublicSite([
        "wss://relay.gittr.space",
        "wss://umbrel.local:4848",
      ])
    ).toEqual(["wss://relay.gittr.space", "wss://umbrel.local:4848"]);
  });
});

describe("omitHomeLanRelayUrls", () => {
  it("keeps public owner GRASP and drops only home/LAN/Tailscale", () => {
    expect(
      omitHomeLanRelayUrls([
        "wss://git.shakespeare.diy/",
        "wss://relay.ngit.dev/",
        "wss://git.nostrhub.io/",
        "wss://umbrel.local:4848/",
        "wss://umbrel.tail51469b.ts.net:4848/",
        "wss://relay.stewlab.win/",
      ])
    ).toEqual([
      "wss://git.shakespeare.diy/",
      "wss://relay.ngit.dev/",
      "wss://git.nostrhub.io/",
      "wss://relay.stewlab.win/",
    ]);
  });
});
