import { describe, expect, it } from "bun:test";
import { DETECTORS, DETECTOR_ORDER, isDetectorId } from "../spec.ts";

// The registry is the seam the layer claim rests on, so its invariants are
// stated as tests: every id is registered under itself, the picker order covers
// the registry exactly, and the guard admits precisely the registered ids.
describe("detector registry", () => {
  it("registers every detector under its own id", () => {
    for (const [key, spec] of Object.entries(DETECTORS)) {
      expect(spec.id).toBe(key as (typeof spec)["id"]);
    }
  });

  it("orders exactly the registered detectors, screen first", () => {
    expect(Object.keys(DETECTORS).sort()).toEqual([...DETECTOR_ORDER].sort());
    expect(DETECTOR_ORDER[0]).toBe("screen");
  });

  it("admits registered ids and refuses the rest", () => {
    expect(isDetectorId("objects-hd")).toBe(true);
    expect(isDetectorId("objects")).toBe(true);
    expect(isDetectorId("rfdetr")).toBe(false);
    expect(isDetectorId(null)).toBe(false);
  });

  it("declares objects-hd as a model detector with stated weights", () => {
    const spec = DETECTORS["objects-hd"];
    expect(spec.kind).toBe("model");
    expect(spec.model).toBe("onnx-community/rfdetr_nano-ONNX");
    expect(spec.weightsMb).toBe(29);
    // COCO-classed, so the operator supplies the class the worker filters on.
    expect(spec.prompts).toBe(true);
  });

  it("keeps screen the only detector without a model", () => {
    const modelless = Object.values(DETECTORS).filter((spec) => spec.kind !== "model");
    expect(modelless.map((spec) => spec.id)).toEqual(["screen"]);
  });
});
