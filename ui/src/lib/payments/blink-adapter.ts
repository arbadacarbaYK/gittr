const BLINK_GRAPHQL_URL = "https://api.blink.sv/graphql";

type BlinkGraphQLError = {
  message?: string;
};

type BlinkResponse<T> = {
  data?: T;
  errors?: BlinkGraphQLError[];
};

async function blinkGraphqlRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const resp = await fetch(BLINK_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) {
    throw new Error(`Blink GraphQL HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as BlinkResponse<T>;
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(msg || "Blink GraphQL error");
  }
  if (!json.data) {
    throw new Error("Blink GraphQL returned no data");
  }
  return json.data;
}

async function resolveBtcWalletId(apiKey: string): Promise<string> {
  const query = `
    query ResolveBtcWallet {
      me {
        defaultAccount {
          defaultWallet {
            id
            __typename
          }
          wallets {
            id
            __typename
          }
        }
      }
    }
  `;
  const data = await blinkGraphqlRequest<{
    me?: {
      defaultAccount?: {
        defaultWallet?: { id?: string; __typename?: string };
        wallets?: Array<{ id?: string; __typename?: string }>;
      };
    };
  }>(apiKey, query, {});
  const account = data.me?.defaultAccount;
  const defaultWallet = account?.defaultWallet;
  if (defaultWallet?.id && defaultWallet.__typename === "BTCWallet") {
    return defaultWallet.id;
  }
  const btcWallet = (account?.wallets || []).find(
    (w) => w?.id && w.__typename === "BTCWallet"
  );
  if (btcWallet?.id) {
    return btcWallet.id;
  }
  throw new Error("No BTC wallet found in Blink account");
}

export async function createBlinkInvoice(params: {
  apiKey: string;
  amountSats: number;
  memo?: string;
}): Promise<{ paymentRequest: string; paymentHash: string }> {
  const walletId = await resolveBtcWalletId(params.apiKey);
  const mutation = `
    mutation CreateBlinkInvoice($input: LnInvoiceCreateInput!) {
      lnInvoiceCreate(input: $input) {
        errors {
          message
        }
        invoice {
          paymentRequest
          paymentHash
        }
      }
    }
  `;
  const data = await blinkGraphqlRequest<{
    lnInvoiceCreate?: {
      errors?: Array<{ message?: string }>;
      invoice?: { paymentRequest?: string; paymentHash?: string };
    };
  }>(params.apiKey, mutation, {
    input: {
      walletId,
      amount: params.amountSats,
      memo: params.memo || undefined,
    },
  });
  const payload = data.lnInvoiceCreate;
  const payloadErrors = payload?.errors || [];
  if (payloadErrors.length > 0) {
    const message = payloadErrors
      .map((e) => e.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(message || "Blink invoice creation failed");
  }
  const paymentRequest = payload?.invoice?.paymentRequest || "";
  const paymentHash = payload?.invoice?.paymentHash || "";
  if (!paymentRequest || !paymentHash) {
    throw new Error("Blink invoice creation returned missing invoice fields");
  }
  return { paymentRequest, paymentHash };
}

export async function isBlinkInvoicePaid(params: {
  apiKey: string;
  paymentHash: string;
}): Promise<boolean> {
  const query = `
    query BlinkInvoiceStatus($input: LnInvoicePaymentStatusByHashInput!) {
      lnInvoicePaymentStatusByHash(input: $input) {
        status
        paymentHash
      }
    }
  `;
  const data = await blinkGraphqlRequest<{
    lnInvoicePaymentStatusByHash?: { status?: string; paymentHash?: string };
  }>(params.apiKey, query, {
    input: { paymentHash: params.paymentHash },
  });
  const status = (data.lnInvoicePaymentStatusByHash?.status || "").toUpperCase();
  return status === "PAID";
}
