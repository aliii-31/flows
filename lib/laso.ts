import {
  createWalletClient,
  http,
  parseUnits,
  publicActions,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";
import { wrapFetchWithSIWx } from "@x402/extensions/sign-in-with-x";

// Laso Finance: x402-paywalled card issuing API. Calls are paid with USDC on
// Base from a dedicated app wallet (LASO_WALLET_PRIVATE_KEY). Auth to free
// Bearer routes uses a CAIP-122 (SIWx) wallet signature.
const BASE_URL = process.env.LASO_BASE_URL ?? "https://laso.finance";
const PRIVATE_KEY = process.env.LASO_WALLET_PRIVATE_KEY;

// x402 won't authorize more than this per call (safety cap). Covers the max
// card ($1000) plus fees, in USDC (6 decimals).
const MAX_PAYMENT = parseUnits("1100", 6);

export const INTL_CARD_TYPE = "Non-Reloadable International";
export const US_CARD_TYPE = "Non-Reloadable U.S.";

export function isLasoConfigured() {
  return !!PRIVATE_KEY;
}

// Loose fetch type — the x402/SIWx wrappers return slightly narrower fetch
// signatures than the global `fetch`; we only call them with string URLs.
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Clients = { siwx: FetchLike; pay: FetchLike };
let _clients: Clients | null = null;

function clients(): Clients {
  if (_clients) return _clients;
  if (!PRIVATE_KEY) {
    throw new Error("LASO_WALLET_PRIVATE_KEY is not configured.");
  }
  const account = privateKeyToAccount(
    (PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`) as Hex
  );
  // x402-fetch expects a wallet client with public actions (a SignerWallet).
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(),
  }).extend(publicActions);

  const built: Clients = {
    siwx: wrapFetchWithSIWx(fetch, account) as FetchLike,
    // Cast bridges a viem version skew between x402's bundled types and ours.
    pay: wrapFetchWithPayment(
      fetch,
      walletClient as unknown as Parameters<typeof wrapFetchWithPayment>[1],
      MAX_PAYMENT
    ) as FetchLike,
  };
  _clients = built;
  return built;
}

// Cached Laso id_token (Bearer for free authenticated routes).
let _token: { value: string; expiresAt: number } | null = null;

async function idToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 30_000) return _token.value;
  const res = await clients().siwx(`${BASE_URL}/auth`);
  if (!res.ok) throw new Error(`Laso /auth failed: ${res.status}`);
  const data = await res.json();
  const token = data?.auth?.id_token as string;
  const expiresIn = Number(data?.auth?.expires_in ?? 3600);
  if (!token) throw new Error("Laso /auth returned no id_token");
  _token = { value: token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

async function bearer(path: string, init?: RequestInit) {
  const token = await idToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Laso ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

/** Order an international (non-reloadable) prepaid card. Paid via x402. */
export async function orderIntlCard(amount: number) {
  const res = await clients().pay(
    `${BASE_URL}/order-intl-card?amount=${encodeURIComponent(amount)}`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Laso order-intl-card failed ${res.status}: ${text}`);
  }
  return res.json();
}

/** Order a U.S. prepaid card (instant, ~10s). Paid via x402. */
export async function orderUsCard(amount: number) {
  const res = await clients().pay(
    `${BASE_URL}/get-card?amount=${encodeURIComponent(amount)}`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Laso get-card failed ${res.status}: ${text}`);
  }
  return res.json();
}

/** Card details + available balance. cardType selects U.S. vs International. */
export async function getCardData(cardType: string, cardId?: string) {
  const params = new URLSearchParams({ card_type: cardType });
  if (cardId) params.set("card_id", cardId);
  return bearer(`/get-card-data?${params.toString()}`);
}

/** Laso account balance (credited refunds, leftover funds). */
export async function getAccountBalance() {
  return bearer(`/get-account-balance`);
}

export async function cancelIntlOrder(cardId: string) {
  return bearer(`/cancel-intl-order`, {
    method: "POST",
    body: JSON.stringify({ card_id: cardId }),
  });
}

export async function refreshCardData(cardId: string, cardType: string) {
  return bearer(`/refresh-card-data`, {
    method: "POST",
    body: JSON.stringify({ card_id: cardId, card_type: cardType }),
  });
}
