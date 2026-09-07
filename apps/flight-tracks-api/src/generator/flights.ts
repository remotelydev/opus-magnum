export function createFlights() {
    const now = new Date();
    const tStartAbs = new Date(now.getTime() - 30 * 60 * 1000); /* now - 30min */
    const tEndAbs = new Date(now.getTime() + 2 * 60 * 60 * 1000); /* now + 2h */
    return [{
        id: 1,
        callsign: "TEST01",
        tStartAbs,
        tEndAbs,
        waypoints: [
          { lon: -0.1, lat: 51.5 },
          { lon: 2.3,  lat: 48.8 },
        ],
        cruiseAltM: 10000,
        speedMps: 250,
    }]
}