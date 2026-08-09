/**
 * The contract of loadConfig, at its two postures:
 *
 *  - RAIL=local is the out-of-the-box demo and must start with nothing but the
 *    contract address, exactly as .env.example promises.
 *  - RAIL=rain talks to a payment API and must refuse to start without the
 *    provisioned credentials.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resetConfig, rulingIdentity, rulingKey } from "../config.ts";

const ADDRESS = `0x${"a".repeat(40)}`;
const OWNER_KEY = `0x${"11".repeat(32)}`;
const AGENT_KEY = `0x${"22".repeat(32)}`;

// loadConfig merges the repo-root `.env` into whatever env it is handed, keyed
// off process.cwd(). These tests are about what the schema demands, so they run
// from a directory with no `.env` in reach.
let previousCwd: string;
let sandbox: string;

beforeEach(() => {
  previousCwd = process.cwd();
  sandbox = mkdtempSync(join(tmpdir(), "tessr-config-"));
  process.chdir(sandbox);
  resetConfig();
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(sandbox, { recursive: true, force: true });
  resetConfig();
});

describe("loadConfig", () => {
  test("RAIL=local starts with only the contract address", () => {
    const config = loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS, RAIL: "local" });
    expect(config.RAIL).toBe("local");
    // Stand-ins, not credentials: the local server never checks them and the
    // real client is never built from them.
    expect(config.RAIN_API_KEY).toBe("local-key");
    expect(config.RAIN_USER_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("RAIL defaults to local", () => {
    const config = loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS });
    expect(config.RAIL).toBe("local");
  });

  test("RAIL=rain without Rain credentials refuses to start", () => {
    expect(() => loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS, RAIL: "rain" })).toThrow(
      /Refusing to start/,
    );
    resetConfig();
    expect(() => loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS, RAIL: "rain" })).toThrow(
      /RAIN_API_KEY\s+required when RAIL=rain/,
    );
    resetConfig();
    expect(() => loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS, RAIL: "rain" })).toThrow(
      /RAIN_USER_ID\s+required when RAIL=rain/,
    );
  });

  test("POLICY_CONTRACT_ADDRESS is required even on the local rail", () => {
    // The policy plane is live in local mode by design: the rail is simulated,
    // the gate never is.
    expect(() => loadConfig({ RAIL: "local" })).toThrow(/POLICY_CONTRACT_ADDRESS/);
  });

  test("RECORD_DENIES is off unless asked for, by name", () => {
    expect(loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS }).RECORD_DENIES).toBe(false);
    resetConfig();
    expect(loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS, RECORD_DENIES: "true" }).RECORD_DENIES).toBe(true);
    resetConfig();
    // "false" is false, not truthy-string true. The reason stringbool exists.
    expect(loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS, RECORD_DENIES: "false" }).RECORD_DENIES).toBe(false);
  });
});

describe("who signs rulings", () => {
  test("without an agent key, the owner's key rules", () => {
    const config = loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS, DEPLOYER_PRIVATE_KEY: OWNER_KEY });
    expect(rulingKey(config)).toBe(OWNER_KEY as `0x${string}`);
    expect(rulingIdentity(config)).toBe("owner (no agent key)");
  });

  test("the agent key rules when present; the owner keeps the admin writes", () => {
    const config = loadConfig({
      POLICY_CONTRACT_ADDRESS: ADDRESS,
      DEPLOYER_PRIVATE_KEY: OWNER_KEY,
      AGENT_PRIVATE_KEY: AGENT_KEY,
    });
    expect(rulingKey(config)).toBe(AGENT_KEY as `0x${string}`);
    expect(rulingIdentity(config)).toMatch(/^agent 0x[0-9a-fA-F]{40}$/);
    // The admin key is untouched by the split.
    expect(config.DEPLOYER_PRIVATE_KEY).toBe(OWNER_KEY as `0x${string}`);
  });

  test("no key at all is named as such", () => {
    const config = loadConfig({ POLICY_CONTRACT_ADDRESS: ADDRESS });
    expect(rulingKey(config)).toBeUndefined();
    expect(rulingIdentity(config)).toBe("none: no key can sign a ruling");
  });
});
