import { NextResponse } from "next/server";
import { createPublicClient, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import {
  FLOWPOOL_ABI,
  FLOWPOOL_ADDRESS,
  USDC_DECIMALS,
  isFlowPoolConfigured,
} from "@/lib/flowpool";
import { projectPoolApr } from "@/lib/lending";
import { getScoringConfig } from "@/lib/scoring";

const client = createPublicClient({ chain: baseSepolia, transport: http() });

/** Pool stats read from the FlowPool contract on Base Sepolia. */
export async function GET() {
  if (!isFlowPoolConfigured()) return NextResponse.json({ configured: false });

  try {
    const base = { address: FLOWPOOL_ADDRESS, abi: FLOWPOOL_ABI } as const;
    const config = await getScoringConfig();
    const [totalAssets, liquidity, outstanding, collateral, fees, loanCount, sharePrice, feeBps] =
      (await Promise.all([
        client.readContract({ ...base, functionName: "totalAssets" }),
        client.readContract({ ...base, functionName: "liquidity" }),
        client.readContract({ ...base, functionName: "outstandingPrincipal" }),
        client.readContract({ ...base, functionName: "collateralHeld" }),
        client.readContract({ ...base, functionName: "feesCollected" }),
        client.readContract({ ...base, functionName: "loanCount" }),
        client.readContract({ ...base, functionName: "sharePrice" }),
        client.readContract({ ...base, functionName: "feeBps" }).catch(() => BigInt(config.lending.protocolFeeBps)),
      ])) as bigint[];

    const fmt = (v: bigint) => Number(formatUnits(v, USDC_DECIMALS));
    const tvl = fmt(totalAssets);
    const out = fmt(outstanding);
    const utilizationBps = tvl > 0 ? Math.round((out / tvl) * 10000) : 0;
    const projection = projectPoolApr(config, {
      utilizationBps,
      riskScore: config.lending.modelRiskScore,
    });
    return NextResponse.json({
      configured: true,
      tvl,
      liquidity: fmt(liquidity),
      outstandingPrincipal: out,
      collateralHeld: fmt(collateral),
      feesCollected: fmt(fees),
      loanCount: Number(loanCount),
      sharePrice: fmt(sharePrice),
      utilization: Math.round(utilizationBps / 100),
      utilizationBps,
      feeBps: Number(feeBps),
      borrowerAprBps: projection.borrowerAprBps,
      projectedLpAprBps: projection.projectedLpAprBps,
      expectedLossBps: projection.expectedLossBps,
      probabilityOfDefaultBps: projection.probabilityOfDefaultBps,
      modelRiskScore: config.lending.modelRiskScore,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read pool";
    return NextResponse.json({ configured: true, error: message }, { status: 200 });
  }
}
