import { PrivyClient } from "@privy-io/server-auth";
import { getAddress, isAddress } from "viem";

const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;

let _privy: PrivyClient | null = null;

/** Server-side Privy client. Throws if app secret is missing. */
export function getPrivy(): PrivyClient {
  if (!appId || !appSecret) {
    throw new Error(
      "Privy server is not configured (need PRIVY_APP_ID or NEXT_PUBLIC_PRIVY_APP_ID, plus PRIVY_APP_SECRET)."
    );
  }
  if (!_privy) {
    _privy = new PrivyClient(
      appId,
      appSecret,
      authorizationPrivateKey
        ? { walletApi: { authorizationPrivateKey } }
        : undefined
    );
  }
  return _privy;
}

export type EmbeddedWallet = { id: string; address: string };
type PrivyLinkedWallet = {
  id?: string | null;
  address?: string;
  walletClientType?: string;
  chainType?: string;
  delegated?: boolean;
};

function normalizeAddress(address?: string | null) {
  return address && isAddress(address) ? getAddress(address) : null;
}

function isEmbeddedEthereumWallet(
  account: unknown
): account is PrivyLinkedWallet {
  const wallet = account as PrivyLinkedWallet;
  return (
    wallet?.walletClientType === "privy" &&
    wallet.chainType === "ethereum" &&
    typeof wallet.address === "string"
  );
}

/**
 * Verifies a Privy access token and returns the user's embedded Ethereum
 * wallet (Privy wallet id + address). Returns null if the user has none.
 * Resolving server-side means the client can't spoof a wallet it doesn't own.
 */
export async function getEmbeddedWallet(
  accessToken: string,
  preferredAddress?: string | null
): Promise<EmbeddedWallet | null> {
  const privy = getPrivy();
  const { userId } = await privy.verifyAuthToken(accessToken);
  const user = await privy.getUserById(userId);

  const requested = normalizeAddress(preferredAddress);
  const primary = normalizeAddress(user.wallet?.address);
  const wallets = user.linkedAccounts.filter(
    (account) => account.type === "wallet" && isEmbeddedEthereumWallet(account)
  );
  const wallet =
    (requested
      ? wallets.find(
          (candidate) => normalizeAddress(candidate.address) === requested
        )
      : undefined) ??
    (primary
      ? wallets.find((candidate) => normalizeAddress(candidate.address) === primary)
      : undefined) ??
    wallets[0];

  if (!wallet?.id || !wallet.address) return null;
  return { id: wallet.id, address: getAddress(wallet.address) };
}
