import type { GeneratorConfig } from "../config.js";

export function createFlights(config: GeneratorConfig) {
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
            waypoints: [
                { lon: -0.1, lat: 51.5 },
                { lon: 2.3,  lat: 48.8 },
            ],
            cruiseAltM: 10000,
            speedMps: 250,
        });
    }
    
    return flights;
}