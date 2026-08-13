import { describe, expect, it } from "vitest";

import {
  assertSafeGitHubApiEndpoint,
  hostnameLooksPrivateOrLocal,
  isSafeOutboundGitUrlSync,
  previewHttpUrlForSafety,
} from "../security/safe-remote-url";

describe("hostnameLooksPrivateOrLocal", () => {
  it("blocks private and local hosts", () => {
    expect(hostnameLooksPrivateOrLocal("localhost")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("127.0.0.1")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("10.0.0.5")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("192.168.1.1")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("172.16.0.1")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("169.254.169.254")).toBe(true);
    expect(hostnameLooksPrivateOrLocal("nas.local")).toBe(true);
  });

  it("allows public hosts", () => {
    expect(hostnameLooksPrivateOrLocal("github.com")).toBe(false);
    expect(hostnameLooksPrivateOrLocal("gitlab.com")).toBe(false);
    expect(hostnameLooksPrivateOrLocal("relay.ngit.dev")).toBe(false);
    expect(hostnameLooksPrivateOrLocal("git.gittr.space")).toBe(false);
  });
});

describe("isSafeOutboundGitUrlSync", () => {
  it("accepts common forge and GRASP URLs", () => {
    expect(isSafeOutboundGitUrlSync("https://github.com/owner/repo.git")).toBe(
      true
    );
    expect(isSafeOutboundGitUrlSync("git@github.com:owner/repo.git")).toBe(
      true
    );
    expect(
      isSafeOutboundGitUrlSync("https://relay.ngit.dev/npub1abc/my-repo.git")
    ).toBe(true);
  });

  it("rejects private and pathless URLs", () => {
    expect(isSafeOutboundGitUrlSync("https://127.0.0.1/owner/repo")).toBe(
      false
    );
    expect(isSafeOutboundGitUrlSync("https://192.168.1.9/o/r")).toBe(false);
    expect(isSafeOutboundGitUrlSync("https://github.com")).toBe(false);
    expect(isSafeOutboundGitUrlSync("file:///etc/passwd")).toBe(false);
  });
});

describe("previewHttpUrlForSafety", () => {
  it("rewrites SSH to https for parsing", () => {
    expect(previewHttpUrlForSafety("git@gitlab.com:g/r.git")).toBe(
      "https://gitlab.com/g/r.git"
    );
  });
});

describe("assertSafeGitHubApiEndpoint", () => {
  it("allows known UI endpoints", () => {
    expect(assertSafeGitHubApiEndpoint("/repos/o/r").ok).toBe(true);
    expect(assertSafeGitHubApiEndpoint("/repos/o/r/commits").ok).toBe(true);
    expect(
      assertSafeGitHubApiEndpoint("/repos/o/r/git/trees/abc?recursive=1").ok
    ).toBe(true);
    expect(assertSafeGitHubApiEndpoint("/users/alice/keys").ok).toBe(true);
  });

  it("rejects open-proxy tricks", () => {
    expect(assertSafeGitHubApiEndpoint("../user").ok).toBe(false);
    expect(assertSafeGitHubApiEndpoint("https://evil.com/x").ok).toBe(false);
    expect(assertSafeGitHubApiEndpoint("/orgs/o/repos").ok).toBe(false);
    expect(assertSafeGitHubApiEndpoint("/gists").ok).toBe(false);
  });
});
