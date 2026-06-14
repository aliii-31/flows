import { generateAuthorizationSignature } from "@privy-io/server-auth/wallet-api";

// Privy Earn (yield) REST API. Server-side only — uses Basic auth (app id +
// app secret) plus, for state-changing calls, a P-256 authorization signature
// generated with the app's authorization key.
const API_BASE = "https://api.privy.io";

const appId =
  process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const appSecret = process.env.PRIVY_APP_SECRET ?? "";
const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;

/** The configured Morpho vault id, set up in the Privy Dashboard (Earn). */
export const GROW_VAULT_ID = process.env.NEXT_PUBLIC_GROW_VAULT_ID ?? "";

export type Vault = {
  id: string;
  name: string;
  provider: string;
  vault_address: string;
  user_apy: number | null;
  app_apy: number | null;
  tvl_usd: number | null;
};

export type Position = {
  total_deposited: string;
  total_withdrawn: string;
  assets_in_vault: string;
  shares_in_vault: string;
};

function basicAuthHeader() {
  const token = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  return `Basic ${token}`;
}

function baseHeaders(): Record<string, string> {
  return {
    Authorization: basicAuthHeader(),
    "privy-app-id": appId,
    "Content-Type": "application/json",
  };
}

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  return `Privy Earn ${res.status}: ${text || res.statusText}`;
}

/** Vault metadata, including the real APY shown to users. */
export async function getVault(vaultId = GROW_VAULT_ID): Promise<Vault> {
  const res = await fetch(`${API_BASE}/v1/earn/ethereum/vaults/${vaultId}`, {
    headers: baseHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** A wallet's position in the vault (deposited principal + current value). */
export async function getPosition(
  walletId: string,
  vaultId = GROW_VAULT_ID
): Promise<Position> {
  const url = `${API_BASE}/v1/wallets/${walletId}/earn/ethereum/vaults?vault_id=${encodeURIComponent(
    vaultId
  )}`;
  const res = await fetch(url, { headers: baseHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// Signs and POSTs a state-changing earn request (deposit/withdraw). `amount` is
// a decimal USDC string (e.g. "5.00"); Privy converts using the vault's asset.
async function postSigned(path: string, body: Record<string, unknown>) {
  if (!authorizationPrivateKey) {
    throw new Error(
      "PRIVY_AUTHORIZATION_PRIVATE_KEY is required for earn deposits/withdrawals."
    );
  }
  const url = `${API_BASE}${path}`;
  const signature = generateAuthorizationSignature({
    input: {
      version: 1,
      method: "POST",
      url,
      body,
      headers: { "privy-app-id": appId },
    },
    authorizationPrivateKey,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      ...(signature ? { "privy-authorization-signature": signature } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export function deposit(
  walletId: string,
  amount: string,
  vaultId = GROW_VAULT_ID
) {
  return postSigned(`/v1/wallets/${walletId}/earn/ethereum/deposit`, {
    vault_id: vaultId,
    amount,
  });
}

export function withdraw(
  walletId: string,
  amount: string,
  vaultId = GROW_VAULT_ID
) {
  return postSigned(`/v1/wallets/${walletId}/earn/ethereum/withdraw`, {
    vault_id: vaultId,
    amount,
  });
}
