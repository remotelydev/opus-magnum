import type { GeneratorConfig } from "../config.js";

// prng algo
function mulberry32(seed: number) {
    return function next() {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

function randomPoint(rand: () => number) {
    return {
        lon: -10 + rand() * 30,
        lat: 35 + rand() * 25,
    };
}

export function createFlights(config: GeneratorConfig) {
    const rand = mulberry32(config.seed);
    const now = new Date();
    const tStartAbs = new Date(now.getTime() - 30 * 60 * 1000); /* now - 30min */
    const tEndAbs = new Date(now.getTime() + 2 * 60 * 60 * 1000); /* now + 2h */

    const flights = [];

    for (let i = 0; i < config.flightCount; i++) {
        flights.push({
            id: i + 1,
            callsign: `TEST-${i + 1}`,
            tStartAbs,
            tEndAbs,
            waypoints: [randomPoint(rand), randomPoint(rand)],
            cruiseAltM: 8000 + rand() * 4000,
            speedMps: 250,
        });
    }

    return flights;
}