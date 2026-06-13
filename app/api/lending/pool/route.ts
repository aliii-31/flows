import { NextResponse } from "next/server";
import { createPublicClient, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import {
  FLOWPOOL_ABI,
  FLOWPOOL_ADDRESS,
  USDC_DECIMALS,
  isFlowPoolConfigured,
} from "@/lib/flowpool";

const client = createPublicClient({ chain: baseSepolia, transport: http() });

/** Pool stats read from the FlowPool contract on Base Sepolia. */
export async function GET() {
  if (!isFlowPoolConfigured()) return NextResponse.json({ configured: false });

  try {
    const base = { address: FLOWPOOL_ADDRESS, abi: FLOWPOOL_ABI } as const;
    const [totalAssets, liquidity, outstanding, collateral, fees, loanCount, sharePrice] =
      (await Promise.all([
        client.readContract({ ...base, functionName: "totalAssets" }),
        client.readContract({ ...base, functionName: "liquidity" }),
        client.readContract({ ...base, functionName: "outstandingPrincipal" }),
        client.readContract({ ...base, functionName: "collateralHeld" }),
        client.readContract({ ...base, functionName: "feesCollected" }),
        client.readContract({ ...base, functionName: "loanCount" }),
        client.readContract({ ...base, functionName: "sharePrice" }),
      ])) as bigint[];

    const fmt = (v: bigint) => Number(formatUnits(v, USDC_DECIMALS));
    const tvl = fmt(totalAssets);
    const out = fmt(outstanding);
    return NextResponse.json({
      configured: true,
      tvl,
      liquidity: fmt(liquidity),
      outstandingPrincipal: out,
      collateralHeld: fmt(collateral),
      feesCollected: fmt(fees),
      loanCount: Number(loanCount),
      sharePrice: fmt(sharePrice),
      utilization: tvl > 0 ? Math.round((out / tvl) * 100) : 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read pool";
    return NextResponse.json({ configured: true, error: message }, { status: 200 });
  }
}
