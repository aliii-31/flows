import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  type Address,
} from "viem";
import { defaultChain } from "./chains";
import { getUsdcAddress } from "./usdc";

const client = createPublicClient({ chain: defaultChain, transport: http() });

/** USDC balance on the default chain, formatted to 2 decimals. "0.00" on any failure. */
export async function getUsdcBalance(address: Address): Promise<string> {
  try {
    const usdc = getUsdcAddress();
    if (usdc) {
      const [raw, decimals] = await Promise.all([
        client.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        client.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);
      return Number(formatUnits(raw, decimals)).toFixed(2);
    }
    const raw = await client.getBalance({ address });
    return Number(
      formatUnits(raw, defaultChain.nativeCurrency.decimals)
    ).toFixed(2);
  } catch {
    return "0.00";
  }
}
