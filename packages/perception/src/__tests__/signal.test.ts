/**
 * The formatters and the matcher have to agree, and the failure mode if they
 * ever stop agreeing is silent: the browser keeps reading correctly, the panel
 * keeps saying `bottle.stock < 3`, and the loop simply never fires. Nothing
 * throws and nothing logs. So the agreement is a test rather than a convention.
 */

import { describe, expect, it } from "bun:test";
import {
  isStockLow,
  stockCount,
  stockLow,
  stockNominal,
  subjectOf,
} from "../signal.ts";

const TARGETS = ["bottle", "a soda can", "  Coke Bottle!  ", "wine glass", "!!!", ""];

describe("subjectOf", () => {
  it("keeps a COCO class as one token", () => {
    expect(subjectOf("bottle")).toBe("bottle");
  });

  it("slugs a phrase the open-vocabulary detector would take", () => {
    expect(subjectOf("a soda can")).toBe("a_soda_can");
  });

  it("trims, lowercases, and drops punctuation rather than quoting it", () => {
    expect(subjectOf("  Coke Bottle!  ")).toBe("coke_bottle");
  });

  it("still names something true when the target is unusable", () => {
    expect(subjectOf("")).toBe("shelf");
    expect(subjectOf("!!!")).toBe("shelf");
  });
});

describe("the matcher agrees with the formatters", () => {
  it("recognises every low reading, whatever the subject", () => {
    for (const target of TARGETS) {
      expect(isStockLow(stockLow(target, 3))).toBe(true);
    }
  });

  it("refuses readings that are not a low claim", () => {
    for (const target of TARGETS) {
      expect(isStockLow(stockCount(target, 7))).toBe(false);
      expect(isStockLow(stockNominal(target))).toBe(false);
    }
  });

  it("recognises a low claim from a source it has never heard of", () => {
    // The point of matching on the mark rather than the whole string: a new
    // detector naming a new subject against its own floor still reaches the gate.
    expect(isStockLow("espresso_beans.stock < 12")).toBe(true);
  });

  it("names the subject and the floor in the reading a judge reads", () => {
    expect(stockLow("bottle", 3)).toBe("bottle.stock < 3");
    expect(stockCount("bottle", 5)).toBe("bottle.stock = 5");
  });
});
