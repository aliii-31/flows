import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { arcTestnet, defaultChain } from "./chains";

// TODO: fill Arc USDC address from Arc docs at the venue (or leave empty if
// USDC is the native currency there — we fall back to the native balance).
const USDC_ADDRESS: Record<number, Address | undefined> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ...(arcTestnet
    ? {
        [arcTestnet.id]: process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS as
          | Address
          | undefined,
      }
    : {}),
};

const client = createPublicClient({ chain: defaultChain, transport: http() });

/** USDC balance on the default chain, formatted to 2 decimals. "0.00" on any failure. */
export async function getUsdcBalance(address: Address): Promise<string> {
  try {
    const usdc = USDC_ADDRESS[defaultChain.id];
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
