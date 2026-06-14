import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";

// FlowPool lives on Base Sepolia (testnet). Address + testnet USDC are public;
// the term-signer key is server-only (authorizes loan terms, never moves funds).
export const FLOWPOOL_CHAIN_ID = baseSepolia.id; // 84532
export const FLOWPOOL_ADDRESS = (process.env.NEXT_PUBLIC_FLOWPOOL_ADDRESS ?? "") as Address;
export const SEPOLIA_USDC = (process.env.NEXT_PUBLIC_BASE_SEPOLIA_USDC ??
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
export const USDC_DECIMALS = 6;

export function isFlowPoolConfigured() {
  return !!FLOWPOOL_ADDRESS;
}
export function isFlowPoolSignerConfigured() {
  return !!process.env.FLOWPOOL_SIGNER_KEY;
}

export const FLOWPOOL_ABI = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "fundLoan", stateMutability: "nonpayable",
    inputs: [
      {
        name: "p", type: "tuple",
        components: [
          { name: "receiver", type: "address" },
          { name: "sender", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "collateral", type: "uint256" },
          { name: "interest", type: "uint256" },
          { name: "dueDate", type: "uint64" },
          { name: "nonce", type: "bytes32" },
          { name: "expiry", type: "uint64" },
        ],
      },
      { name: "sig", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "liquidate", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "outstandingPrincipal", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collateralHeld", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feesCollected", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sharePrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "loanCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "sharesOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "loans", stateMutability: "view", inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "receiver", type: "address" },
      { name: "sender", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "collateral", type: "uint256" },
      { name: "interest", type: "uint256" },
      { name: "dueDate", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
  },
] as const;

export type LoanParams = {
  receiver: Address;
  sender: Address;
  principal: bigint;
  collateral: bigint;
  interest: bigint;
  dueDate: bigint;
  nonce: Hex;
  expiry: bigint;
};

const EIP712_TYPES = {
  Loan: [
    { name: "receiver", type: "address" },
    { name: "sender", type: "address" },
    { name: "principal", type: "uint256" },
    { name: "collateral", type: "uint256" },
    { name: "interest", type: "uint256" },
    { name: "dueDate", type: "uint64" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

/** Server-side: sign loan terms with FLOWPOOL_SIGNER_KEY (the contract's termsSigner). */
export async function signLoanTerms(params: LoanParams): Promise<Hex> {
  const key = process.env.FLOWPOOL_SIGNER_KEY;
  if (!key) throw new Error("FLOWPOOL_SIGNER_KEY is not configured");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
  return account.signTypedData({
    domain: {
      name: "FlowPool",
      version: "1",
      chainId: FLOWPOOL_CHAIN_ID,
      verifyingContract: FLOWPOOL_ADDRESS,
    },
    types: EIP712_TYPES,
    primaryType: "Loan",
    message: params,
  });
}
