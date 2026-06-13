"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePrivy, useSignTypedData } from "@privy-io/react-auth";
import type { SignTypedDataParams } from "@privy-io/react-auth";
import type { WidgetConfig } from "@lifi/widget";
import { EthereumProvider } from "@lifi/widget-provider-ethereum";

// LI.FI widget is client-only and heavy — load it lazily, never during SSR.
const LiFiWidget = dynamic(
  () => import("@lifi/widget").then((m) => m.LiFiWidget),
  { ssr: false }
);

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const LIFI_API = "https://li.quest/v1";

type LifiTypedData = {
  primaryType: string;
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  message: Record<string, unknown>;
  signature?: string;
};

type LifiToken = {
  symbol?: string;
};

type LifiStep = {
  action?: {
    fromAddress?: string;
    fromAmount?: string;
    fromChainId?: number;
    fromToken?: LifiToken;
    toAddress?: string;
    toChainId?: number;
    toToken?: LifiToken;
  };
  estimate?: {
    gasCosts?: unknown[];
    feeCosts?: unknown[];
    toAmount?: string;
    toAmountUSD?: string;
  };
  execution?: unknown;
  includedSteps?: unknown[];
  tool?: string;
  toolDetails?: { name?: string };
  typedData?: LifiTypedData[];
};

type LifiRoute = {
  fromAmountUSD?: string;
  fromChainId?: number;
  fromToken?: LifiToken;
  id?: string;
  steps?: LifiStep[];
  toAmountUSD?: string;
  toChainId?: number;
  toToken?: LifiToken;
};

type RelayState =
  | { status: "idle"; message?: string; txLink?: string }
  | { status: "signing"; message?: string; txLink?: string }
  | { status: "relaying"; message?: string; txLink?: string }
  | { status: "done"; message?: string; txLink?: string }
  | { status: "error"; message?: string; txLink?: string };

function getGaslessStep(route?: LifiRoute | null) {
  return route?.steps?.find((step) =>
    step.typedData?.some(
      (typedData) => typedData.primaryType === "PermitWitnessTransferFrom"
    )
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong.";
}

async function relaySignedStep(step: LifiStep, typedData: LifiTypedData[]) {
  const { execution, ...stepBase } = step;
  void execution;
  const response = await fetch(`${LIFI_API}/relayer/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...stepBase, typedData }),
  });
  const result = (await response.json()) as
    | { status: "ok"; data: { taskId: string; txLink?: string } }
    | { status: "error"; data?: { message?: string } };

  if (result.status === "error") {
    throw new Error(result.data?.message ?? "LI.FI relayer rejected the swap.");
  }
  if (!response.ok) throw new Error("LI.FI relayer rejected the swap.");

  return result.data;
}

// Any token is searchable (no token allow list). Featured tokens give the CEX
// feel; chains are limited to a few cheap EVM chains to reduce wallet errors.
const config: WidgetConfig = {
  integrator: "flows-space",
  providers: [EthereumProvider()],
  appearance: "dark",
  variant: "compact",
  fromChain: 8453, // Base
  fromToken: USDC_BASE,
  slippage: 0.005,
  useRelayerRoutes: true,
  chains: {
    allow: [8453, 42161, 10, 137], // Base, Arbitrum, Optimism, Polygon
  },
  tokens: {
    featured: [
      { chainId: 8453, address: USDC_BASE, symbol: "USDC", decimals: 6, name: "USD Coin" },
      { chainId: 8453, address: WETH_BASE, symbol: "WETH", decimals: 18, name: "Wrapped Ether" },
    ],
  },
  // Strip the DeFi clutter for a clean, CEX-like feel.
  hiddenUI: {
    poweredBy: true,
    language: true,
    bridgesSettings: true,
    integratorStepDetails: true,
    routeCardPriceImpact: true,
    routeTokenDescription: true,
    gasRefuelMessage: true,
  },
  // Match the Flows warm-dark palette (LI.FI v4 uses MUI colorSchemes).
  theme: {
    colorSchemes: {
      dark: {
        palette: {
          primary: { main: "#E8A33D" },
          secondary: { main: "#9B9189" },
          background: { default: "#14110F", paper: "#1D1916" },
          text: { primary: "#F4EFE9", secondary: "#9B9189" },
        },
      },
    },
    shape: { borderRadius: 16 },
    container: { border: "1px solid #2A241F", borderRadius: "20px" },
  },
};

export default function SwapModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { getAccessToken } = usePrivy();
  const { signTypedData } = useSignTypedData();
  const [gaslessRoute, setGaslessRoute] = useState<LifiRoute | null>(null);
  const [relayState, setRelayState] = useState<RelayState>({
    status: "idle",
  });
  const logged = useRef<Set<string>>(new Set());
  const gaslessRouteId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let unsub = () => {};
    import("@lifi/widget").then(({ widgetEvents, WidgetEvent }) => {
      if (cancelled) return;
      const handler = (routes: LifiRoute[]) => {
        const nextGaslessRoute =
          routes.find((route) => Boolean(getGaslessStep(route))) ?? null;
        if (gaslessRouteId.current !== nextGaslessRoute?.id) {
          gaslessRouteId.current = nextGaslessRoute?.id;
          setRelayState({ status: "idle" });
        }
        setGaslessRoute(nextGaslessRoute);
      };
      widgetEvents.on(WidgetEvent.AvailableRoutes, handler);
      unsub = () => widgetEvents.off(WidgetEvent.AvailableRoutes, handler);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [open]);

  const handleGaslessSwap = useCallback(async () => {
    const step = getGaslessStep(gaslessRoute);
    if (!step?.typedData?.length) return;

    try {
      setRelayState({ status: "signing", message: "Sign in wallet" });
      const signedTypedData: LifiTypedData[] = [];

      for (const typedData of step.typedData) {
        const { signature } = await signTypedData(
          {
            domain: typedData.domain,
            message: typedData.message,
            primaryType: typedData.primaryType,
            types: typedData.types,
          } as SignTypedDataParams,
          {
            address: step.action?.fromAddress,
            uiOptions: {
              buttonText: "Sign",
              description: "Authorize this gasless swap.",
              title: "Gasless swap",
            },
          }
        );
        signedTypedData.push({ ...typedData, signature });
      }

      setRelayState({ status: "relaying", message: "Submitting" });
      const relayed = await relaySignedStep(step, signedTypedData);
      setRelayState({
        status: "done",
        message: "Submitted",
        txLink: relayed.txLink,
      });

      const token = await getAccessToken();
      await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: "swap.executed",
          amount_usd: Number(
            gaslessRoute?.fromAmountUSD ?? gaslessRoute?.toAmountUSD ?? 0
          ),
          payload: {
            gasless: true,
            taskId: relayed.taskId,
            txLink: relayed.txLink,
            fromToken: gaslessRoute?.fromToken?.symbol,
            toToken: gaslessRoute?.toToken?.symbol,
            fromChain: gaslessRoute?.fromChainId,
            toChain: gaslessRoute?.toChainId,
          },
        }),
      });
    } catch (error) {
      setRelayState({
        status: "error",
        message: getErrorMessage(error),
      });
    }
  }, [gaslessRoute, getAccessToken, signTypedData]);

  // Log completed swaps to the event store (score-bearing trading behavior).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let unsub = () => {};
    import("@lifi/widget").then(({ widgetEvents, WidgetEvent }) => {
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = async (update: any) => {
        try {
          const route = update?.route ?? update;
          const steps = route?.steps ?? [];
          const done =
            steps.length > 0 &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            steps.every((s: any) => s?.execution?.status === "DONE");
          if (!done || !route?.id || logged.current.has(route.id)) return;
          logged.current.add(route.id);
          const token = await getAccessToken();
          await fetch("/api/events", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              type: "swap.executed",
              amount_usd: Number(route.fromAmountUSD ?? route.toAmountUSD ?? 0),
              payload: {
                fromToken: route.fromToken?.symbol,
                toToken: route.toToken?.symbol,
                fromChain: route.fromChainId,
                toChain: route.toChainId,
              },
            }),
          });
        } catch {
          /* best-effort */
        }
      };
      widgetEvents.on(WidgetEvent.RouteExecutionUpdated, handler);
      unsub = () => widgetEvents.off(WidgetEvent.RouteExecutionUpdated, handler);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [open, getAccessToken]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="text-ink-soft absolute -top-9 right-0 text-sm hover:text-ink"
        >
          Close
        </button>
        <div className="overflow-hidden rounded-2xl">
          <LiFiWidget integrator="flows-space" config={config} />
        </div>
        {gaslessRoute ? (
          <div className="border-gold/25 bg-gold/10 mt-3 rounded-2xl border p-3">
            <button
              type="button"
              onClick={handleGaslessSwap}
              disabled={
                relayState.status === "signing" ||
                relayState.status === "relaying"
              }
              className="bg-gold text-charcoal hover:bg-gold/90 disabled:bg-gold/50 w-full rounded-xl px-4 py-3 text-sm font-semibold transition"
            >
              {relayState.status === "signing"
                ? "Sign in wallet"
                : relayState.status === "relaying"
                  ? "Submitting"
                  : relayState.status === "done"
                    ? "Submitted"
                    : "Gasless swap"}
            </button>
            {relayState.message || relayState.txLink ? (
              <div className="text-ink-soft mt-2 text-xs">
                {relayState.message}
                {relayState.txLink ? (
                  <>
                    {" "}
                    <a
                      href={relayState.txLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-gold underline underline-offset-2"
                    >
                      View
                    </a>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
