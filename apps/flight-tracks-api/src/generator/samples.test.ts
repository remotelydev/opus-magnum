import { describe, expect, it } from "vitest";
import { samplesAlongRoute } from "./samples.js";

describe("samplesAlongRoute", () => {
  it("starts and ends on the route endpoints", () => {
    const samples = samplesAlongRoute(
      [
        { lon: 0, lat: 0 },
        { lon: 10, lat: 0 },
      ],
      0,
      100,
      8000,
      10,
    );

    expect(samples[0]).toMatchObject({ t: 0, lon: 0, lat: 0, alt: 8000 });
    expect(samples.at(-1)).toMatchObject({ t: 100, lon: 10, lat: 0, alt: 8000 });
    expect(samples.length).toBe(11); // 0..90 step 10, plus final t=100
  });

  it("places the midpoint near the corner of an L-shaped route", () => {
    const samples = samplesAlongRoute(
      [
        { lon: 0, lat: 0 },
        { lon: 10, lat: 0 },
        { lon: 10, lat: 10 },
      ],
      0,
      1000,
      8000,
      30,
    );

    const mid = samples[Math.floor(samples.length / 2)]!;
    expect(mid.lon).toBeCloseTo(10, 5);
    expect(mid.lat).toBeCloseTo(0, 0); // just after / at end of first equal-length leg
    expect(samples.at(-1)).toMatchObject({ lon: 10, lat: 10, t: 1000 });
  });

  it("returns a single sample when there is only one waypoint", () => {
    const samples = samplesAlongRoute([{ lon: 1, lat: 2 }], 50, 100, 9000);
    expect(samples).toEqual([{ t: 50, lon: 1, lat: 2, alt: 9000 }]);
  });

  it("returns a single sample when the route has zero length", () => {
    const samples = samplesAlongRoute(
      [
        { lon: 5, lat: 5 },
        { lon: 5, lat: 5 },
      ],
      0,
      100,
      7000,
      10,
    );
    expect(samples).toEqual([{ t: 0, lon: 5, lat: 5, alt: 7000 }]);
  });

  it("returns a single sample when tEnd is not after tStart", () => {
    const samples = samplesAlongRoute(
      [
        { lon: 0, lat: 0 },
        { lon: 10, lat: 0 },
      ],
      100,
      100,
      8000,
      10,
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ t: 100, lon: 0, lat: 0, alt: 8000 });
  });
});
