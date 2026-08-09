/**
 * Create the one payment route the funding leg spends from, and read it back.
 *
 *   bun run scripts/payment-route.ts list                       # what already exists
 *   bun run scripts/payment-route.ts create --address 0x…       # dry run, prints the plan
 *   bun run scripts/payment-route.ts create --address 0x… --confirm
 *
 * A route is a standing instruction: dollars arriving over ACH land as USDC at
 * an onchain destination. Ours is usd/ach to usdc/base, which in the sandbox
 * means Base Sepolia. Monad is not an available Rain rail and nothing here
 * pretends it is; the Monad story lives entirely in the policy plane.
 *
 * Routes are immutable. There is no PATCH, only DELETE. So this creates at most
 * one, and `--confirm` is required because the thing it makes is permanent. Put
 * the id it prints into `.env` as RAIN_PAYMENT_ROUTE_ID and never think about it
 * again; `fundBudget()` reuses that id forever.
 *
 * This exists as a script rather than as SDK surface because it is an operator
 * action performed once per account, not something an agent does at runtime.
 */

import { rainClient } from "../packages/settlement/src/rain/client.ts";
import {
  createPaymentRoute,
  listPaymentRoutes,
  onrampRoute,
} from "../packages/settlement/src/rain/routes.ts";

const command = process.argv[2] ?? "help";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  const next = index >= 0 ? process.argv[index + 1] : undefined;
  return next && !next.startsWith("--") ? next : undefined;
}

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function client() {
  const apiKey = env("RAIN_API_KEY");
  const userId = env("RAIN_USER_ID");
  if (!apiKey || !userId) die("RAIN_API_KEY and RAIN_USER_ID must be set in .env");
  const baseUrl = env("RAIN_BASE_URL");
  return rainClient({ apiKey, userId, ...(baseUrl ? { baseUrl } : {}) });
}

switch (command) {
  case "list": {
    const found = await listPaymentRoutes(client());
    if (!found.ok) die(found.error.message);
    if (found.value.length === 0) {
      console.log("\n  no payment routes on this account\n");
      break;
    }
    console.log("");
    for (const route of found.value) {
      console.log(`  ${route.id}`);
    }
    console.log(`\n  RAIN_PAYMENT_ROUTE_ID should name one of the above\n`);
    break;
  }

  case "create": {
    const address = arg("address") ?? env("RAIN_FUND_DESTINATION_ADDRESS");
    if (!address) die("pass --address 0x… or set RAIN_FUND_DESTINATION_ADDRESS in .env");

    console.log("");
    console.log("  source        usd over ach");
    console.log("  destination   usdc on base (Base Sepolia in the sandbox)");
    console.log(`  address       ${address}`);

    if (!process.argv.includes("--confirm")) {
      console.log("\n  dry run, nothing sent. A route cannot be edited or replaced once it");
      console.log("  exists, so read the plan above and re-run with --confirm.\n");
      break;
    }

    const created = await createPaymentRoute(client(), onrampRoute(address));
    if (!created.ok) die(created.error.message);
    console.log(`\n  created ${created.value.id}`);
    console.log(`  put this in .env as RAIN_PAYMENT_ROUTE_ID\n`);
    break;
  }

  default:
    console.log(`
  bun run scripts/payment-route.ts list
  bun run scripts/payment-route.ts create --address 0x… [--confirm]
`);
}
