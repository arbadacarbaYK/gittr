/**
 * Safe deploy-target resolution for operator scripts.
 * Never interpolate env into a shell — callers must use execFile/spawn argv.
 */
import { homedir } from "os";
import { resolve as resolvePath } from "path";

/** Absolute unix-ish path without shell metacharacters. */
export const SAFE_ABS_PATH = /^\/[A-Za-z0-9._/\-]+$/;
export const SAFE_HOST = /^[A-Za-z0-9._\-]+$/;
export const SAFE_USER = /^[A-Za-z0-9._\-]+$/;
export const SAFE_HTTPS_ORIGIN =
  /^https:\/\/[A-Za-z0-9._\-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._\-\/]*)?$/;

export type DeployTarget = {
  identity: string;
  user: string;
  host: string;
  deployPath: string;
  siteUrl: string;
};

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolvePath(homedir(), p.slice(2));
  return p;
}

function assertSafeIdentityPath(identity: string): void {
  if (identity.includes("..") || /[^A-Za-z0-9._/\-]/.test(identity)) {
    throw new Error("deploy identity path rejected");
  }
  if (!identity.startsWith("/")) {
    throw new Error("deploy identity path must be absolute (after ~ expansion)");
  }
}

/**
 * Resolve deploy target from structured env (preferred) or a strict
 * `GITTR_DEPLOY_SSH='ssh -i KEY user@host'` form.
 */
export function resolveDeployTargetFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DeployTarget | null {
  const deployPath = env.GITTR_DEPLOY_PATH || "/opt/ngit/ui";
  const siteUrl = env.GITTR_SITE_URL || "https://gittr.space";
  if (!SAFE_ABS_PATH.test(deployPath)) {
    throw new Error("GITTR_DEPLOY_PATH rejected (unsafe characters)");
  }
  if (!SAFE_HTTPS_ORIGIN.test(siteUrl)) {
    throw new Error("GITTR_SITE_URL rejected (must be https origin/path)");
  }

  const identityEnv = env.GITTR_DEPLOY_IDENTITY;
  const hostEnv = env.GITTR_DEPLOY_HOST;
  if (identityEnv && hostEnv) {
    const user = env.GITTR_DEPLOY_USER || "root";
    if (!SAFE_USER.test(user) || !SAFE_HOST.test(hostEnv)) {
      throw new Error("GITTR_DEPLOY_USER/HOST rejected");
    }
    const identity = expandHome(identityEnv);
    assertSafeIdentityPath(identity);
    return { identity, user, host: hostEnv, deployPath, siteUrl };
  }

  const sshCmd = env.GITTR_DEPLOY_SSH?.trim();
  if (!sshCmd) return null;

  // Strict: ssh -i <key> <user@host>   (no extra flags / pipes / ; &&)
  const m = /^ssh\s+-i\s+(\S+)\s+([A-Za-z0-9._\-]+)@([A-Za-z0-9._\-]+)$/.exec(
    sshCmd
  );
  if (!m) {
    throw new Error(
      "GITTR_DEPLOY_SSH must be exactly: ssh -i <key> <user@host> (or use GITTR_DEPLOY_HOST + GITTR_DEPLOY_IDENTITY)"
    );
  }
  const identity = expandHome(m[1]!);
  assertSafeIdentityPath(identity);
  return {
    identity,
    user: m[2]!,
    host: m[3]!,
    deployPath,
    siteUrl,
  };
}
