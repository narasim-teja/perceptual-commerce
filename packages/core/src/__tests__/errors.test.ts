/**
 * `describeError` is what the CLI and the dashboard print. The one rendering
 * that has bitten us: a 401 from Rain looks like a business decline unless it is
 * named for what it is — our credential being refused.
 */

import { describe, expect, test } from "bun:test";
import { describeError } from "../errors.ts";

describe("mint_declined", () => {
  test("carries the response body's message when Rain sent one", () => {
    const text = describeError({
      kind: "mint_declined",
      status: 400,
      body: { message: "expiresAt must be in the future" },
    });
    expect(text).toBe("Rain declined the mint (HTTP 400): expiresAt must be in the future");
  });

  test("joins an array-shaped message, which Rain's envelope allows", () => {
    const text = describeError({
      kind: "mint_declined",
      status: 400,
      body: { message: ["amountInUSDCents must be >= 1", "allowedMccs must be unique"] },
    });
    expect(text).toBe(
      "Rain declined the mint (HTTP 400): amountInUSDCents must be >= 1; allowedMccs must be unique",
    );
  });

  test("stays terse when there is no body worth quoting", () => {
    expect(describeError({ kind: "mint_declined", status: 500 })).toBe("Rain declined the mint (HTTP 500)");
    expect(describeError({ kind: "mint_declined", status: 400, body: { message: "" } })).toBe(
      "Rain declined the mint (HTTP 400)",
    );
    expect(describeError({ kind: "mint_declined", status: 400, body: "not an object" })).toBe(
      "Rain declined the mint (HTTP 400)",
    );
  });

  test("a 401 or 403 is named as an auth failure, not a decline", () => {
    for (const status of [401, 403]) {
      expect(describeError({ kind: "mint_declined", status, body: { message: "Invalid api key" } })).toBe(
        "Rain rejected the API key. Check RAIN_API_KEY.",
      );
    }
  });
});

describe("the rest of the closed union renders one legible line each", () => {
  test("policy_denied carries the reason and the onchain ruling", () => {
    expect(
      describeError({ kind: "policy_denied", reason: "kill_switch", onchainRef: "0xabc" }),
    ).toBe("policy denied: kill_switch (0xabc)");
  });

  test("every kind produces a non-empty string", () => {
    expect(describeError({ kind: "payee_unverified", check: "some-bar" })).toContain("some-bar");
    expect(describeError({ kind: "intent_expired" })).not.toBe("");
    expect(describeError({ kind: "card_declined", reason: "scoped card mcc not allowed" })).toContain("mcc");
    expect(describeError({ kind: "settlement_failed", cause: "socket closed" })).toContain("socket closed");
  });
});
