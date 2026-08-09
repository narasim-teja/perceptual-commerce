# @pc/perception

Pluggable signal sources. Exports the `PerceptionSource` interface and `Observation` type, the
signal vocabulary (`stockLow`, `isStockLow` — the formatters and the matcher live in one file so
they cannot drift), and `manualSource`, the hand-driven source the demo and the quickstart use.

```typescript
const camera = manualSource("shelf-cam-1");
camera.emit({ signal: "bottle.stock < 3", confidence: 0.97 });
```

Downstream, a manual emit is indistinguishable from a camera: same `Observation`, same path through
the spine. The real vision layer runs in the browser (`frontend/lib/perception.ts`) because a
source constructed in the server process would sit on the same side of the trust boundary as the
Rain credential — `vision.ts` here is deliberately unimplemented and says so.

**What perception can never do: spend.** It holds no keys, imports nothing from settlement, and the
most a source can produce is an observation the policy plane is free to refuse.
