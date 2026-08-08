/**
 * Kill switch for all user-facing security-audit UI (repo badge, homepage
 * blurb, help topic, settings toggle). Off until gittr's own dependency tree
 * is clean — we don't advertise CVE scanning while flagging ourselves.
 * Enable by building with NEXT_PUBLIC_SECURITY_AUDIT_UI=1.
 */
export const SECURITY_AUDIT_UI_ENABLED =
  process.env.NEXT_PUBLIC_SECURITY_AUDIT_UI === "1";
