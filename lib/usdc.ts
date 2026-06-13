import type { Address } from "viem";
import { base } from "viem/chains";
import { arcTestnet, defaultChain } from "./chains";

// USDC's ERC-20 interface is 6 decimals on both Arc and Base. (Arc's *native*
// USDC gas token is 18 decimals, but we transact and display via the ERC-20
// interface so the two chains behave identically.)
export const USDC_DECIMALS = 6;

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

/** USDC ERC-20 address for a chain, or undefined if unknown. */
export function getUsdcAddress(chainId: number = defaultChain.id) {
  return USDC_ADDRESS[chainId];
}
