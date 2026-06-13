import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { arbitrum, base, baseSepolia, optimism, polygon } from "wagmi/chains";

// wagmi config wired to Privy. The LI.FI widget auto-detects this WagmiProvider
// and transacts from the user's connected Privy embedded wallet — no separate
// wallet connect step.
export const wagmiConfig = createConfig({
  chains: [base, arbitrum, optimism, polygon, baseSepolia],
  transports: {
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
    [baseSepolia.id]: http(),
  },
});
