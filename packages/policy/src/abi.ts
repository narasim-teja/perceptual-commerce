/**
 * ABI for `contract/src/Policy.sol`, hand-maintained as a `const` so viem infers
 * argument and return types end to end. If you change the Solidity, change this.
 *
 * (Only the surface the SDK actually calls is listed. `forge inspect Policy abi`
 * prints the full thing if you need more.)
 */
export const policyAbi = [
  {
    type: "function",
    name: "evaluateMint",
    stateMutability: "view",
    inputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "payee", type: "bytes32" },
      { name: "mcc", type: "uint16" },
      { name: "amountCents", type: "uint256" },
    ],
    outputs: [
      { name: "allowed", type: "bool" },
      { name: "reason", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "ruleMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "payee", type: "bytes32" },
      { name: "mcc", type: "uint16" },
      { name: "amountCents", type: "uint256" },
    ],
    outputs: [
      { name: "allowed", type: "bool" },
      { name: "reason", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "currentWindowUsage",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "mints", type: "uint256" },
      { name: "cents", type: "uint256" },
    ],
  },
  { type: "function", name: "killSwitch", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxAmountCents", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "velocityWindowSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "maxMintsPerWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxCentsPerWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "allowedPayee",
    stateMutability: "view",
    inputs: [{ name: "payee", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowedMcc",
    stateMutability: "view",
    inputs: [{ name: "mcc", type: "uint16" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "ruled",
    stateMutability: "view",
    inputs: [{ name: "intentHash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "setKillSwitch",
    stateMutability: "nonpayable",
    inputs: [{ name: "active", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setPayee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "payee", type: "bytes32" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setMcc",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mcc", type: "uint16" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setLimits",
    stateMutability: "nonpayable",
    inputs: [
      { name: "maxAmountCents", type: "uint256" },
      { name: "windowSeconds", type: "uint256" },
      { name: "maxMints", type: "uint256" },
      { name: "maxCents", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "MintRuling",
    inputs: [
      { name: "intentHash", type: "bytes32", indexed: true },
      { name: "payee", type: "bytes32", indexed: true },
      { name: "mcc", type: "uint16", indexed: false },
      { name: "amountCents", type: "uint256", indexed: false },
      { name: "allowed", type: "bool", indexed: false },
      { name: "reason", type: "uint8", indexed: false },
      { name: "rulingAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "KillSwitchSet",
    inputs: [{ name: "active", type: "bool", indexed: false }],
  },
] as const;

/** Index-aligned with the `Reason` enum in Policy.sol. Order is load-bearing. */
export const REASONS = [
  "none",
  "kill_switch",
  "payee_not_allowed",
  "mcc_not_allowed",
  "amount_over_cap",
  "velocity_exceeded",
  "already_ruled",
] as const;

export type ReasonCode = (typeof REASONS)[number];

export function reasonFromCode(code: number): ReasonCode {
  return REASONS[code] ?? "kill_switch"; // unknown code -> treat as a deny reason, never "none"
}
