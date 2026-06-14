import { encodeFunctionData, erc20Abi, parseUnits, getAddress } from "viem";
import { getPrivy } from "./privy";

// Base mainnet USDC — scheduled payments execute here from the user's embedded
// wallet, signed server-side via the app's authorization key. Requires the user
// to have granted the app's session signer to their wallet (one-time).
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CAIP2 = "eip155:8453" as const;
const USDC_DECIMALS = 6;

/** Sends a USDC transfer from a Privy embedded wallet. Returns the tx hash. */
export async function sendUsdcFromWallet(
  walletId: string,
  to: string,
  amountUsdc: number
): Promise<string> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(to), parseUnits(amountUsdc.toFixed(USDC_DECIMALS), USDC_DECIMALS)],
  });
  const res = await getPrivy().walletApi.ethereum.sendTransaction({
    walletId,
    caip2: BASE_CAIP2,
    transaction: { to: getAddress(USDC_BASE), data },
  });
  return res.hash;
}
