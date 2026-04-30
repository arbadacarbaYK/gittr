import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { createBlinkInvoice, isBlinkInvoicePaid } from "@/lib/payments/blink-adapter";
import { createPayment } from "@/lib/payments/lnbits-adapter";

import { exec } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { promisify } from "util";

import { verifyNostrAuth } from "./push-auth";

const execAsync = promisify(exec);
const PUSH_PAYMENT_TTL_SECONDS = 15 * 60;

async function resolveBridgeDbPath(): Promise<string | null> {
  const configPaths = [
    process.env.HOME
      ? `${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json`
      : null,
    "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json",
  ].filter(Boolean) as string[];

  for (const configPath of configPaths) {
    try {
      if (existsSync(configPath)) {
        const configContent = readFileSync(configPath, "utf-8");
        const config = JSON.parse(configContent);
        if (config.DbFile && typeof config.DbFile === "string") {
          const homeDir = configPath.includes("/home/git-nostr")
            ? "/home/git-nostr"
            : process.env.HOME || "";
          return config.DbFile.replace(/^~/, homeDir);
        }
      }
    } catch {
      // Continue fallback path resolution.
    }
  }

  if (process.env.HOME) {
    return `${process.env.HOME}/.config/git-nostr/git-nostr-db.sqlite`;
  }
  return null;
}

function escSql(value: string): string {
  return value.replace(/'/g, "''");
}

async function ensureSqlite(): Promise<boolean> {
  try {
    await execAsync("which sqlite3", { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

async function runSql(dbPath: string, query: string): Promise<string> {
  const escapedQuery = query.replace(/'/g, "'\\''");
  const command = `echo '${escapedQuery}' | sqlite3 "${dbPath}"`;
  const { stdout } = await execAsync(command, { timeout: 5000 });
  return stdout || "";
}

async function getPushCostSats(
  dbPath: string,
  ownerPubkey: string,
  repo: string
): Promise<number> {
  const query = `SELECT PushCostSats FROM RepositoryPushPolicy WHERE OwnerPubKey='${escSql(
    ownerPubkey
  )}' AND RepositoryName='${escSql(repo)}' LIMIT 1`;
  try {
    const stdout = await runSql(dbPath, query);
    const parsed = parseInt(stdout.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  } catch {
    // Missing table or no row => no paywall
  }
  return 0;
}

type PushIntent = {
  intentId: string;
  invoice: string;
  paymentHash: string;
  status: string;
  expiresAt: number;
};

async function getActiveIntent(
  dbPath: string,
  ownerPubkey: string,
  repo: string,
  payerPubkey: string
): Promise<PushIntent | null> {
  const query = `SELECT IntentId,Invoice,PaymentHash,Status,ExpiresAt FROM RepositoryPushPaymentIntent WHERE OwnerPubKey='${escSql(
    ownerPubkey
  )}' AND RepositoryName='${escSql(repo)}' AND PayerPubKey='${escSql(
    payerPubkey
  )}' AND Status='pending' ORDER BY UpdatedAt DESC LIMIT 1`;
  try {
    const stdout = await runSql(dbPath, query);
    const line = stdout.trim();
    if (!line) return null;
    const [
      intentId = "",
      invoice = "",
      paymentHash = "",
      status = "",
      expiresAtStr = "0",
    ] = line.split("|");
    const expiresAt = parseInt(expiresAtStr, 10);
    if (!intentId || !Number.isFinite(expiresAt)) return null;
    if (Math.floor(Date.now() / 1000) > expiresAt) return null;
    return { intentId, invoice, paymentHash, status, expiresAt };
  } catch {
    return null;
  }
}

async function getPaidIntent(
  dbPath: string,
  ownerPubkey: string,
  repo: string,
  payerPubkey: string
): Promise<PushIntent | null> {
  const query = `SELECT IntentId,Invoice,PaymentHash,Status,ExpiresAt FROM RepositoryPushPaymentIntent WHERE OwnerPubKey='${escSql(
    ownerPubkey
  )}' AND RepositoryName='${escSql(repo)}' AND PayerPubKey='${escSql(
    payerPubkey
  )}' AND Status='paid' ORDER BY PaidAt DESC, UpdatedAt DESC LIMIT 1`;
  try {
    const stdout = await runSql(dbPath, query);
    const line = stdout.trim();
    if (!line) return null;
    const [
      intentId = "",
      invoice = "",
      paymentHash = "",
      status = "",
      expiresAtStr = "0",
    ] = line.split("|");
    const expiresAt = parseInt(expiresAtStr, 10);
    if (!intentId || !Number.isFinite(expiresAt)) return null;
    return { intentId, invoice, paymentHash, status, expiresAt };
  } catch {
    return null;
  }
}

async function saveIntent(
  dbPath: string,
  ownerPubkey: string,
  repo: string,
  payerPubkey: string,
  pushCostSats: number,
  invoice: string,
  paymentHash: string
): Promise<PushIntent> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + PUSH_PAYMENT_TTL_SECONDS;
  const intentId = randomUUID();
  const query = `INSERT INTO RepositoryPushPaymentIntent (IntentId,OwnerPubKey,RepositoryName,PayerPubKey,PushCostSats,Invoice,PaymentHash,Status,ExpiresAt,CreatedAt,UpdatedAt,PaidAt) VALUES ('${escSql(
    intentId
  )}','${escSql(ownerPubkey)}','${escSql(repo)}','${escSql(
    payerPubkey
  )}',${pushCostSats},'${escSql(invoice)}','${escSql(
    paymentHash
  )}','pending',${expiresAt},${now},${now},NULL)`;
  await runSql(dbPath, query);
  return { intentId, invoice, paymentHash, status: "pending", expiresAt };
}

async function markIntentPaid(dbPath: string, intentId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const query = `UPDATE RepositoryPushPaymentIntent SET Status='paid',PaidAt=${now},UpdatedAt=${now} WHERE IntentId='${escSql(
    intentId
  )}'`;
  await runSql(dbPath, query);
}

async function consumeLatestPaidIntent(
  dbPath: string,
  ownerPubkey: string,
  repo: string,
  payerPubkey: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const query = `UPDATE RepositoryPushPaymentIntent SET Status='consumed',UpdatedAt=${now} WHERE IntentId=(SELECT IntentId FROM RepositoryPushPaymentIntent WHERE OwnerPubKey='${escSql(
    ownerPubkey
  )}' AND RepositoryName='${escSql(repo)}' AND PayerPubKey='${escSql(
    payerPubkey
  )}' AND Status='paid' ORDER BY PaidAt DESC, UpdatedAt DESC LIMIT 1)`;
  await runSql(dbPath, query);
  const verifyQuery = `SELECT 1 FROM RepositoryPushPaymentIntent WHERE OwnerPubKey='${escSql(
    ownerPubkey
  )}' AND RepositoryName='${escSql(repo)}' AND PayerPubKey='${escSql(
    payerPubkey
  )}' AND Status='paid' LIMIT 1`;
  const remaining = (await runSql(dbPath, verifyQuery)).trim();
  return remaining.length === 0;
}

async function deletePendingIntents(
  dbPath: string,
  ownerPubkey: string,
  repo: string,
  payerPubkey: string
): Promise<void> {
  const query = `DELETE FROM RepositoryPushPaymentIntent WHERE OwnerPubKey='${escSql(
    ownerPubkey
  )}' AND RepositoryName='${escSql(repo)}' AND PayerPubKey='${escSql(
    payerPubkey
  )}' AND Status='pending'`;
  await runSql(dbPath, query);
}

async function verifyServerManagedPayment(
  paymentHash: string,
  minAmountSats: number,
  lnbitsUrl: string,
  lnbitsReadKey: string,
  blinkApiKey = ""
): Promise<boolean> {
  try {
    if (lnbitsUrl && lnbitsReadKey && paymentHash) {
      return verifyLnbitsPayment(
        lnbitsUrl,
        lnbitsReadKey,
        paymentHash,
        minAmountSats
      );
    }
    if (blinkApiKey && paymentHash) {
      return isBlinkInvoicePaid({ apiKey: blinkApiKey, paymentHash });
    }
  } catch {
    return false;
  }
  return false;
}

async function maybeSettleIntent(
  dbPath: string,
  ownerPubkey: string,
  repo: string,
  payerPubkey: string,
  pushCostSats: number,
  lnbitsUrl = "",
  lnbitsReadKey = "",
  blinkApiKey = ""
): Promise<{ authorized: boolean; intent?: PushIntent }> {
  const existingPaidIntent = await getPaidIntent(dbPath, ownerPubkey, repo, payerPubkey);
  if (existingPaidIntent) {
    return { authorized: true, intent: existingPaidIntent };
  }
  const intent = await getActiveIntent(dbPath, ownerPubkey, repo, payerPubkey);
  if (!intent) return { authorized: false };
  if (!intent.paymentHash) return { authorized: false, intent };
  const paid = await verifyServerManagedPayment(
    intent.paymentHash,
    pushCostSats,
    lnbitsUrl,
    lnbitsReadKey,
    blinkApiKey
  );
  if (!paid) return { authorized: false, intent };
  await markIntentPaid(dbPath, intent.intentId);
  return { authorized: true, intent: { ...intent, status: "paid" } };
}

async function verifyLnbitsPayment(
  lnbitsUrl: string,
  lnbitsAdminKey: string,
  paymentHash: string,
  minAmountSats: number
): Promise<boolean> {
  const url = `${lnbitsUrl.replace(
    /\/$/,
    ""
  )}/api/v1/payments/${encodeURIComponent(paymentHash)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "X-Api-Key": lnbitsAdminKey,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) return false;
  const data: any = await resp.json().catch(() => null);
  if (!data) return false;

  // Different LNbits versions return slightly different shapes.
  const paid = !!(data.paid || data.details?.pending === false);
  const msatCandidates = [
    data.amount_msat,
    data.amount,
    data.details?.amount_msat,
    data.details?.amount,
  ]
    .map((v: any) => (typeof v === "number" ? v : Number(v)))
    .filter((v: number) => Number.isFinite(v));

  const absMsat =
    msatCandidates.length > 0
      ? Math.max(...msatCandidates.map((v) => Math.abs(v)))
      : 0;
  const amountSats = Math.floor(absMsat / 1000);
  return paid && amountSats >= minAmountSats;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!(await ensureSqlite())) {
    return res.status(503).json({ error: "sqlite3 not available on server" });
  }

  const dbPath = await resolveBridgeDbPath();
  if (!dbPath || !existsSync(dbPath)) {
    return res.status(503).json({ error: "Bridge database not available" });
  }

  if (req.method === "GET") {
    const ownerPubkey =
      typeof req.query.ownerPubkey === "string" ? req.query.ownerPubkey : "";
    const repo = typeof req.query.repo === "string" ? req.query.repo : "";
    const payer =
      typeof req.query.payerPubkey === "string" ? req.query.payerPubkey : "";
    const ownerLnbitsUrlHeader = req.headers["x-owner-lnbits-url"];
    const ownerLnbitsReadKeyHeader = req.headers["x-owner-lnbits-read-key"];
    const ownerBlinkApiKeyHeader = req.headers["x-owner-blink-api-key"];
    const ownerLnbitsUrl =
      typeof ownerLnbitsUrlHeader === "string" ? ownerLnbitsUrlHeader.trim() : "";
    const ownerLnbitsReadKey =
      typeof ownerLnbitsReadKeyHeader === "string"
        ? ownerLnbitsReadKeyHeader.trim()
        : "";
    const ownerBlinkApiKey =
      typeof ownerBlinkApiKeyHeader === "string"
        ? ownerBlinkApiKeyHeader.trim()
        : "";
    if (!ownerPubkey || !repo) {
      return res
        .status(400)
        .json({ error: "ownerPubkey and repo are required" });
    }
    const pushCostSats = await getPushCostSats(
      dbPath,
      ownerPubkey.toLowerCase(),
      repo
    );
    if (!payer) {
      return res.status(200).json({ pushCostSats, authorized: false });
    }
    if (pushCostSats > 0) {
      const settled = await maybeSettleIntent(
        dbPath,
        ownerPubkey.toLowerCase(),
        repo,
        payer.toLowerCase(),
        pushCostSats,
        ownerLnbitsUrl,
        ownerLnbitsReadKey,
        ownerBlinkApiKey
      );
      if (settled.authorized) {
        return res.status(200).json({
          pushCostSats,
          authorized: true,
          intentId: settled.intent?.intentId,
          paymentHash: settled.intent?.paymentHash,
        });
      }
      return res.status(200).json({
        pushCostSats,
        authorized: false,
        pendingIntentId: settled.intent?.intentId,
      });
    }
    return res.status(200).json({ pushCostSats, authorized: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Only rate limit mutating/authenticated actions.
  // GET is used by UI polling for exact invoice status and should not be throttled aggressively.
  const limiter = await rateLimiters.payment(req as any);
  if (limiter) {
    return res.status(429).json(JSON.parse(await limiter.text()));
  }

  const {
    ownerPubkey,
    repo,
    payerPubkey: bodyPayerPubkey,
    paymentHash,
    lnbitsUrl,
    lnbitsAdminKey,
    action,
    ownerLnbitsUrl,
    ownerLnbitsInvoiceKey,
    ownerLnbitsAdminKey,
    ownerBlinkApiKey,
  } = req.body || {};
  if (action === "create_intent") {
    if (typeof ownerPubkey !== "string" || typeof repo !== "string") {
      return res.status(400).json({
        error: "ownerPubkey and repo are required",
      });
    }
    const normalizedPayer =
      typeof bodyPayerPubkey === "string"
        ? bodyPayerPubkey.trim().toLowerCase()
        : "";
    if (!/^[0-9a-f]{64}$/.test(normalizedPayer)) {
      return res.status(400).json({
        error: "payerPubkey (hex, 64 chars) is required for create_intent",
      });
    }
    const normalizedOwner = ownerPubkey.toLowerCase();
    const payerPubkey = normalizedPayer;
    const pushCostSats = await getPushCostSats(dbPath, normalizedOwner, repo);
    if (pushCostSats <= 0) {
      return res.status(200).json({
        authorized: true,
        pushCostSats: 0,
      });
    }

    const effectiveLnbitsUrl =
      typeof ownerLnbitsUrl === "string" ? ownerLnbitsUrl.trim() : "";
    const effectiveLnbitsReadKey =
      typeof ownerLnbitsInvoiceKey === "string" &&
      ownerLnbitsInvoiceKey.trim().length > 0
        ? ownerLnbitsInvoiceKey.trim()
        : typeof ownerLnbitsAdminKey === "string"
        ? ownerLnbitsAdminKey.trim()
        : "";
    const effectiveLnbitsWriteKey =
      typeof ownerLnbitsInvoiceKey === "string" &&
      ownerLnbitsInvoiceKey.trim().length > 0
        ? ownerLnbitsInvoiceKey.trim()
        : typeof ownerLnbitsAdminKey === "string"
        ? ownerLnbitsAdminKey.trim()
        : "";
    const effectiveBlinkApiKey =
      typeof ownerBlinkApiKey === "string" ? ownerBlinkApiKey.trim() : "";
    const canUseLnbits =
      !!effectiveLnbitsUrl && !!effectiveLnbitsReadKey && !!effectiveLnbitsWriteKey;
    const canUseBlink = !!effectiveBlinkApiKey;

    if (!canUseLnbits && !canUseBlink) {
      return res.status(400).json({
        error:
          "Push paywall requires owner LNbits URL+Invoice/Admin key OR Blink API key in Settings -> Account. Profile wallet fallback is disabled.",
      });
    }

    const existingIntent = await getActiveIntent(
      dbPath,
      normalizedOwner,
      repo,
      payerPubkey
    );
    if (existingIntent) {
      if (existingIntent.paymentHash) {
        const settled = await maybeSettleIntent(
          dbPath,
          normalizedOwner,
          repo,
          payerPubkey,
          pushCostSats,
          effectiveLnbitsUrl,
          effectiveLnbitsReadKey,
          effectiveBlinkApiKey
        );
        if (settled.authorized) {
          return res.status(200).json({
            authorized: true,
            pushCostSats,
            intentId: settled.intent?.intentId,
            paymentHash: settled.intent?.paymentHash,
          });
        }
      }
      // Do not reuse old pending invoices (can be stale/wrong amount/provider).
      await deletePendingIntents(dbPath, normalizedOwner, repo, payerPubkey);
    }

    let invoice = "";
    let resolvedPaymentHash = "";
    try {
      if (canUseLnbits) {
        const invoiceResp = await createPayment(
          { url: effectiveLnbitsUrl, adminKey: effectiveLnbitsWriteKey },
          {
            out: false,
            amount: pushCostSats,
            memo: `Push authorization for ${normalizedOwner}/${repo}`,
          }
        );
        invoice = (
          invoiceResp.payment_request ||
          invoiceResp.bolt11 ||
          ""
        ).replace(/^lightning:/i, "");
        resolvedPaymentHash =
          invoiceResp.payment_hash || invoiceResp.checking_id || "";
      } else {
        const blinkInvoice = await createBlinkInvoice({
          apiKey: effectiveBlinkApiKey,
          amountSats: pushCostSats,
          memo: `Push authorization for ${normalizedOwner}/${repo}`,
        });
        invoice = blinkInvoice.paymentRequest.replace(/^lightning:/i, "");
        resolvedPaymentHash = blinkInvoice.paymentHash;
      }
    } catch (createErr: any) {
      return res.status(502).json({
        error: createErr?.message || "Failed to create push payment invoice",
      });
    }

    if (!invoice) {
      return res.status(500).json({ error: "Failed to create payment intent" });
    }
    const intent = await saveIntent(
      dbPath,
      normalizedOwner,
      repo,
      payerPubkey,
      pushCostSats,
      invoice,
      resolvedPaymentHash
    );
    return res.status(200).json({
      authorized: false,
      pushCostSats,
      intentId: intent.intentId,
      paymentRequest: intent.invoice,
      paymentHash: intent.paymentHash,
      status: intent.status,
      expiresAt: intent.expiresAt,
    });
  }

  if (action === "consume_paid_intent") {
    if (
      typeof ownerPubkey !== "string" ||
      typeof repo !== "string" ||
      typeof bodyPayerPubkey !== "string"
    ) {
      return res.status(400).json({
        error: "ownerPubkey, repo, and payerPubkey are required",
      });
    }
    const consumed = await consumeLatestPaidIntent(
      dbPath,
      ownerPubkey.toLowerCase(),
      repo,
      bodyPayerPubkey.toLowerCase()
    );
    return res.status(200).json({ ok: true, consumed });
  }

  const auth = await verifyNostrAuth(req);
  if (!auth.authorized || !auth.pubkey) {
    return res
      .status(401)
      .json({ error: auth.error || "Authentication required" });
  }

  if (
    typeof ownerPubkey !== "string" ||
    typeof repo !== "string" ||
    typeof paymentHash !== "string" ||
    typeof lnbitsUrl !== "string" ||
    typeof lnbitsAdminKey !== "string"
  ) {
    return res.status(400).json({
      error:
        "ownerPubkey, repo, paymentHash, lnbitsUrl, and lnbitsAdminKey are required",
    });
  }

  const normalizedOwner = ownerPubkey.toLowerCase();
  const payerPubkey = auth.pubkey.toLowerCase();
  const pushCostSats = await getPushCostSats(dbPath, normalizedOwner, repo);
  if (pushCostSats <= 0) {
    return res.status(200).json({
      authorized: true,
      pushCostSats: 0,
    });
  }

  const paid = await verifyLnbitsPayment(
    lnbitsUrl,
    lnbitsAdminKey,
    paymentHash,
    pushCostSats
  );
  if (!paid) {
    return res.status(402).json({
      authorized: false,
      error: "Payment not confirmed",
      pushCostSats,
    });
  }

  const pendingIntent = await getActiveIntent(
    dbPath,
    normalizedOwner,
    repo,
    payerPubkey
  );
  if (!pendingIntent || pendingIntent.paymentHash !== paymentHash) {
    return res.status(409).json({
      authorized: false,
      error: "Payment hash does not match the active push invoice intent",
      pushCostSats,
    });
  }
  await markIntentPaid(dbPath, pendingIntent.intentId);
  return res.status(200).json({
    authorized: true,
    pushCostSats,
    intentId: pendingIntent.intentId,
    paymentHash: pendingIntent.paymentHash,
  });
}
