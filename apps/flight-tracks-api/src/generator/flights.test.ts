import { describe, expect, it } from "vitest";
import type { GeneratorConfig } from "../config.js";
import { createFlights } from "./flights.js";

const baseConfig: GeneratorConfig = {
  seed: 42,
  flightCount: 3,
  windowPastSec: 3600,
  windowFutureSec: 28800,
};

describe("createFlights", () => {
  it("is deterministic for the same seed", () => {
    const a = createFlights(baseConfig);
    const b = createFlights(baseConfig);

    expect(a[0]!.waypoints).toEqual(b[0]!.waypoints);
    expect(a[0]!.cruiseAltM).toEqual(b[0]!.cruiseAltM);
    expect(a.map((f) => f.id)).toEqual([1, 2, 3]);
  });

  it("changes waypoints when the seed changes", () => {
    const a = createFlights(baseConfig);
    const b = createFlights({ ...baseConfig, seed: 43 });

    expect(a[0]!.waypoints).not.toEqual(b[0]!.waypoints);
  });
});
