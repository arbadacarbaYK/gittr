import { describe, expect, it } from "vitest";
import { resolveDeployTargetFromEnv } from "./deploy-target-env";

describe("resolveDeployTargetFromEnv", () => {
  it("returns null when unset", () => {
    expect(resolveDeployTargetFromEnv({})).toBeNull();
  });

  it("accepts structured host + identity", () => {
    const t = resolveDeployTargetFromEnv({
      GITTR_DEPLOY_HOST: "91.99.86.115",
      GITTR_DEPLOY_IDENTITY: "/home/ops/.ssh/id_ed25519",
      GITTR_DEPLOY_USER: "root",
      GITTR_DEPLOY_PATH: "/opt/ngit/ui",
      GITTR_SITE_URL: "https://gittr.space",
    });
    expect(t).toEqual({
      identity: "/home/ops/.ssh/id_ed25519",
      user: "root",
      host: "91.99.86.115",
      deployPath: "/opt/ngit/ui",
      siteUrl: "https://gittr.space",
    });
  });

  it("parses strict GITTR_DEPLOY_SSH", () => {
    const t = resolveDeployTargetFromEnv({
      GITTR_DEPLOY_SSH: "ssh -i /home/ops/.ssh/key root@example.com",
    });
    expect(t?.host).toBe("example.com");
    expect(t?.user).toBe("root");
    expect(t?.identity).toBe("/home/ops/.ssh/key");
  });

  it("rejects shell metacharacters in GITTR_DEPLOY_SSH", () => {
    expect(() =>
      resolveDeployTargetFromEnv({
        GITTR_DEPLOY_SSH: "ssh -i /k root@h; curl evil",
      })
    ).toThrow(/must be exactly/);
  });

  it("rejects unsafe deploy path", () => {
    expect(() =>
      resolveDeployTargetFromEnv({
        GITTR_DEPLOY_HOST: "h",
        GITTR_DEPLOY_IDENTITY: "/k",
        GITTR_DEPLOY_PATH: "/opt/ngit/ui; rm -rf /",
      })
    ).toThrow(/GITTR_DEPLOY_PATH/);
  });

  it("rejects non-https site URL", () => {
    expect(() =>
      resolveDeployTargetFromEnv({
        GITTR_DEPLOY_HOST: "h",
        GITTR_DEPLOY_IDENTITY: "/k",
        GITTR_SITE_URL: "http://gittr.space",
      })
    ).toThrow(/GITTR_SITE_URL/);
  });
});
