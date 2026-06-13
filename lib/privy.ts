import { PrivyClient } from "@privy-io/server-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;

let _privy: PrivyClient | null = null;

/** Server-side Privy client. Throws if app secret is missing. */
export function getPrivy(): PrivyClient {
  if (!appId || !appSecret) {
    throw new Error(
      "Privy server is not configured (need NEXT_PUBLIC_PRIVY_APP_ID + PRIVY_APP_SECRET)."
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

/**
 * Verifies a Privy access token and returns the user's embedded Ethereum
 * wallet (Privy wallet id + address). Returns null if the user has none.
 * Resolving server-side means the client can't spoof a wallet it doesn't own.
 */
export async function getEmbeddedWallet(
  accessToken: string
): Promise<EmbeddedWallet | null> {
  const privy = getPrivy();
  const { userId } = await privy.verifyAuthToken(accessToken);
  const user = await privy.getUserById(userId);

  const wallet = user.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      // embedded (Privy-managed) Ethereum wallet
      (a as { walletClientType?: string }).walletClientType === "privy" &&
      (a as { chainType?: string }).chainType === "ethereum"
  ) as { id?: string; address?: string } | undefined;

  if (!wallet?.id || !wallet.address) return null;
  return { id: wallet.id, address: wallet.address };
}
